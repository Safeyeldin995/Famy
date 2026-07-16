import { test, expect } from "@playwright/test";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../admin-client.mjs";
import { loadEnv } from "../env.mjs";
import { readRegistry } from "../registry.mjs";

loadEnv();
test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });
const QA_PASSWORD = "QaRuntime!2026Test";

test("eligible provider appears in customer search; ineligible does not", async ({ page, browser }) => {
  // The QA provider fixture (global-setup) signed up and completed onboarding
  // for real, but has no service/zone yet — not eligible.
  const registry = readRegistry();
  const providerEntry = registry.users.find((u: any) => u.key === "provider");
  expect(providerEntry, "provider fixture should be registered").toBeTruthy();

  const { data: provider } = await supabaseAdmin.from("providers").select("id").eq("profile_id", providerEntry!.userId).single();
  expect(provider).toBeTruthy();
  const providerId = provider!.id;

  const customerEntry = registry.users.find((u: any) => u.key === "customer");
  const customerClient = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "");
  const customerEmail = `phone-${customerEntry.phone.replace(/\D/g, "")}@famio.local`;
  const { error: customerSignInError } = await customerClient.auth.signInWithPassword({ email: customerEmail, password: QA_PASSWORD });
  expect(customerSignInError).toBeFalsy();

  // 1) Not eligible yet: unverified, no service.
  const beforeCheck = await customerClient.from("eligible_providers").select("id").eq("id", providerId).maybeSingle();
  expect(beforeCheck.data, "provider should not be eligible before setup").toBeNull();

  // 2) Real admin action: approve provider verification via the actual UI.
  await page.goto(`/admin/provider/${providerId}`);
  const verifyButton = page.getByRole("button", { name: /^approve$/i }).first();
  await expect(verifyButton).toBeVisible({ timeout: 10_000 });
  await verifyButton.click();
  await expect(page.getByText(/verified/i).first()).toBeVisible({ timeout: 10_000 });

  // 3) Give it one approved, in-range-priced, zone-covered, requirement-free service.
  // (Requesting/approving a specific service is a separate UI flow already
  // covered by admin write tests; here we seed the supporting fixture data
  // and drive only the approval action, which is what's under test.)
  const { data: existingServices } = await supabaseAdmin.from("provider_services").select("service_id").eq("provider_id", providerId);
  const existingServiceIds = new Set((existingServices ?? []).map((row) => row.service_id));
  const { data: activeServices } = await supabaseAdmin.from("services").select("id, name_en, base_price").eq("is_active", true);
  const service = activeServices?.find((row) => !existingServiceIds.has(row.id));
  expect(service, "an unused active service should exist for the eligibility fixture").toBeTruthy();
  const { data: ps, error: psError } = await supabaseAdmin.from("provider_services").insert({ provider_id: providerId, service_id: service!.id, status: "pending" }).select().single();
  expect(psError, `provider-service fixture insert failed: ${psError?.message}`).toBeFalsy();

  const { data: zone } = await supabaseAdmin.from("zones").insert({
    name_en: "QA_eligibility_zone", name_ar: "QA_منطقة_أهلية", boundary_type: "polygon", is_active: true,
    polygon: [{ lat: 30.0, lng: 31.0 }, { lat: 30.0, lng: 31.05 }, { lat: 30.03, lng: 31.02 }],
  }).select().single();
  await supabaseAdmin.from("zone_services").insert({ zone_id: zone!.id, service_id: service!.id });
  await supabaseAdmin.from("zone_providers").insert({ zone_id: zone!.id, provider_id: providerId });
  await supabaseAdmin.from("availability_rules").insert({
    provider_id: providerId, weekday: 1, start_time: "09:00", end_time: "17:00",
  });

  await page.reload();
  const serviceRow = page.getByRole("listitem").filter({ hasText: service!.name_en });
  const approveServiceButton = serviceRow.getByRole("button", { name: /^approve$/i });
  await expect(approveServiceButton).toBeVisible({ timeout: 10_000 });
  const [approvalResponse] = await Promise.all([
    page.waitForResponse((r) =>
      r.url().includes("/rpc/admin_set_provider_service_status")
      && (r.request().postData() ?? "").includes(ps!.id),
    ),
    approveServiceButton.click(),
  ]);
  expect(
    approvalResponse.ok(),
    `provider-service approval failed: ${approvalResponse.status()} ${await approvalResponse.text()}`,
  ).toBe(true);
  await page.reload();
  const { data: approvedService } = await supabaseAdmin
    .from("provider_services")
    .select("status")
    .eq("id", ps!.id)
    .single();
  expect(approvedService!.status, "provider-service approval should persist").toBe("approved");
  const { count: approvalAuditCount } = await supabaseAdmin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("entity", "provider_services")
    .eq("entity_id", ps!.id)
    .eq("action", "UPDATE");
  expect(approvalAuditCount, "approval should create exactly one audit event").toBe(1);

  // 4) Now eligible, and visible through the real customer-facing gate.
  const afterCheck = await customerClient.from("eligible_providers").select("id").eq("id", providerId).maybeSingle();
  expect(afterCheck.data?.id, "provider should be eligible after verification + approved zone-covered service").toBe(providerId);

  const { data: eligDetail } = await supabaseAdmin.rpc("provider_eligibility", { p_provider_id: providerId });
  expect(eligDetail?.[0]?.is_eligible).toBe(true);

  const customerContext = await browser.newContext({
    storageState: path.resolve(process.cwd(), "qa/.auth/customer.json"),
  });
  const customerPage = await customerContext.newPage();
  await customerPage.goto("/search");
  await expect(customerPage.locator(`a[href="/provider/${providerId}"]`)).toBeVisible({ timeout: 15_000 });
  await customerContext.close();

  const rejectionService = activeServices?.find((row) => row.id !== service!.id && !existingServiceIds.has(row.id));
  expect(rejectionService, "an unused service should exist for rejection coverage").toBeTruthy();
  const { data: rejectedPs, error: rejectedPsError } = await supabaseAdmin
    .from("provider_services")
    .insert({ provider_id: providerId, service_id: rejectionService!.id, status: "pending" })
    .select()
    .single();
  expect(rejectedPsError).toBeFalsy();

  await page.reload();
  const rejectionRow = page.getByRole("listitem").filter({ hasText: rejectionService!.name_en });
  await rejectionRow.getByRole("button", { name: /^reject$/i }).click();
  const reasonInput = rejectionRow.getByLabel(/reason/i);
  const confirmReject = rejectionRow.getByRole("button", { name: /confirm reject/i });
  await expect(confirmReject).toBeDisabled();
  await reasonInput.fill("QA_ rejection reason");
  await expect(confirmReject).toBeEnabled();
  await confirmReject.click();
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: rejectionService!.name_en })).toContainText(/rejected/i);
  const { data: rejectedStored } = await supabaseAdmin.from("provider_services").select("status,rejection_reason").eq("id", rejectedPs!.id).single();
  expect(rejectedStored).toMatchObject({ status: "rejected", rejection_reason: "QA_ rejection reason" });

  // cleanup QA fixture rows this test created directly (provider account itself
  // is cleaned by global-teardown).
  await supabaseAdmin.from("zone_providers").delete().eq("zone_id", zone!.id);
  await supabaseAdmin.from("zone_services").delete().eq("zone_id", zone!.id);
  await supabaseAdmin.from("zones").delete().eq("id", zone!.id);
  await supabaseAdmin.from("provider_services").delete().eq("id", ps!.id);
  await supabaseAdmin.from("provider_services").delete().eq("id", rejectedPs!.id);
  await supabaseAdmin.from("availability_rules").delete().eq("provider_id", providerId);
});
