import { expect, test } from "@playwright/test";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../admin-client.mjs";
import { authenticatedClient } from "../authenticated-client.mjs";
import { loadEnv } from "../env.mjs";
import { readRegistry } from "../registry.mjs";
import { captureErrors } from "./helpers";

loadEnv();
test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

test("controlled Provider becomes visible, hides on suspension, and restores through the shared pipeline", async ({ page, browser }) => {
  test.slow();
  test.setTimeout(300_000);
  const suffix = Date.now();
  const registry = readRegistry();
  const providerUser = registry.users.find((user: any) => user.key === "provider");
  const { data: provider } = await supabaseAdmin.from("providers").select("id,is_verified,is_active,vacation_mode").eq("profile_id", providerUser.userId).single();
  const { data: providerProfile } = await supabaseAdmin.from("profiles").select("full_name").eq("id", providerUser.userId).single();
  const { data: category } = await supabaseAdmin.from("categories").select("id").eq("is_active", true).limit(1).single();
  expect(provider).toBeTruthy();
  expect(category).toBeTruthy();

  const serviceName = `QA_Patch2_Marketplace_${suffix}`;
  const zoneName = `QA_Patch2_Zone_${suffix}`;
  const evidencePath = `${providerUser.userId}/QA_patch2_${suffix}.pdf`;
  const { data: service, error: serviceError } = await supabaseAdmin.from("services").insert({
    category_id: category!.id, slug: `qa-patch2-${suffix}`, name_en: serviceName, name_ar: serviceName,
    pricing_model: "hourly", base_price: 100, minimum_price: 80, maximum_price: 120,
    provider_pricing_allowed: true, is_active: true,
  }).select().single();
  expect(serviceError).toBeFalsy();
  const { data: requirement } = await supabaseAdmin.from("service_requirements").insert({
    service_id: service!.id, code: `qa_patch2_req_${suffix}`, name_en: `QA_Patch2_Evidence_${suffix}`,
    name_ar: `QA_Patch2_Evidence_${suffix}`, requirement_type: "certification", fulfillment_mode: "provider",
    required_for_provider_approval: true, required_during_booking: false, evidence_required: true,
    provider_extra_fee: 0, is_active: true, sort_order: 1,
  }).select().single();
  const upload = await supabaseAdmin.storage.from("provider-documents").upload(
    evidencePath,
    new TextEncoder().encode("%PDF-1.4\n% QA Patch 2 evidence\n%%EOF"),
    { contentType: "application/pdf" },
  );
  expect(upload.error).toBeFalsy();
  const { data: fulfillment } = await supabaseAdmin.from("provider_requirement_fulfillments").insert({
    provider_id: provider!.id, requirement_id: requirement!.id, status: "pending",
    evidence_storage_path: evidencePath, notes: "QA_ controlled eligibility evidence",
  }).select().single();
  const { data: providerService } = await supabaseAdmin.from("provider_services").insert({
    provider_id: provider!.id, service_id: service!.id, status: "pending", price_override: 100,
  }).select().single();
  const { data: zone } = await supabaseAdmin.from("zones").insert({
    name_en: zoneName, name_ar: zoneName, boundary_type: "polygon", is_active: true,
    polygon: [{ lat: 30, lng: 31 }, { lat: 30, lng: 31.05 }, { lat: 30.03, lng: 31.02 }], travel_fee: 0,
  }).select().single();

  const customerContext = await browser.newContext({ storageState: path.resolve(process.cwd(), "qa/.auth/customer.json") });
  const customerPage = await customerContext.newPage();
  const providerContext = await browser.newContext({ storageState: path.resolve(process.cwd(), "qa/.auth/provider.json") });
  const providerPage = await providerContext.newPage();
  const adminErrors = captureErrors(page);
  const customerErrors = captureErrors(customerPage);
  const providerErrors = captureErrors(providerPage);
  let bookingId: string | undefined;
  const gotoAdmin = async (url: string) => {
    await page.goto(url);
    // AdminLayout starts two auth checks on each document load. Let both settle
    // before another full navigation so the test never manufactures aborts.
    await page.waitForLoadState("networkidle");
  };

  try {
    await customerPage.goto("/search");
    await customerPage.getByLabel("Service").selectOption(service!.id);
    await expect(customerPage.locator(`a[href="/provider/${provider!.id}"]`)).toHaveCount(0);
    await customerPage.reload();
    await expect(customerPage.locator(`a[href="/provider/${provider!.id}"]`)).toHaveCount(0);

    const customerUser = registry.users.find((user: any) => user.key === "customer");
    const { data: customerAddress } = await supabaseAdmin.from("addresses").select("id").eq("user_id", customerUser.userId).eq("is_default", true).single();
    const blockedStart = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    blockedStart.setUTCHours(10, 0, 0, 0);
    const blockedBooking = await authenticatedClient("customer").from("bookings").insert({
      customer_id: customerUser.userId, provider_id: provider!.id, service_id: service!.id, address_id: customerAddress!.id,
      start_at: blockedStart.toISOString(), end_at: new Date(blockedStart.getTime() + 60 * 60 * 1000).toISOString(),
      status: "pending", notes: "QA_ must be rejected while ineligible", price_subtotal: 100, price_total: 100,
    });
    expect(blockedBooking.error?.code).toBe("23514");

    await gotoAdmin(`/admin/provider/${provider!.id}`);
    await expect(page.getByText("Marketplace eligible: No")).toBeVisible();
    await expect(page.getByText("Provider is not verified", { exact: true })).toBeVisible();
    await expect(page.getByText("Provider-service relationship is not approved", { exact: true })).toBeVisible();
    await expect(page.getByText("Required evidence is missing or not approved", { exact: true })).toBeVisible();
    await expect(page.getByText("Active Provider and Service zone coverage is missing", { exact: true })).toBeVisible();
    await expect(page.getByText("Provider has no valid availability", { exact: true })).toBeVisible();

    await gotoAdmin("/admin/services");
    const serviceCard = page.getByRole("listitem").filter({ hasText: serviceName }).first();
    const requirementRow = serviceCard.getByRole("listitem").filter({ hasText: `QA_Patch2_Evidence_${suffix}` });
    await requirementRow.getByRole("button", { name: /^review$/i }).click();
    const [evidenceResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/rest/v1/provider_requirement_fulfillments") && response.request().method() === "PATCH"),
      requirementRow.getByRole("button", { name: "passed", exact: true }).click(),
    ]);
    expect(evidenceResponse.ok(), await evidenceResponse.text()).toBe(true);
    await expect(requirementRow.getByRole("button", { name: "passed", exact: true })).toBeDisabled();

    await gotoAdmin(`/admin/provider/${provider!.id}`);
    const [verificationResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/rpc/admin_set_provider_verification") && response.request().method() === "POST"),
      page.getByRole("button", { name: /^approve$/i }).last().click(),
    ]);
    expect(verificationResponse.ok(), await verificationResponse.text()).toBe(true);
    expect((await supabaseAdmin.from("providers").select("is_verified,is_active").eq("id", provider!.id).single()).data)
      .toMatchObject({ is_verified: true, is_active: true });
    const serviceRow = page.getByRole("listitem").filter({ hasText: serviceName });
    const [approvalResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/rpc/admin_set_provider_service_status")),
      serviceRow.getByRole("button", { name: /^approve$/i }).click(),
    ]);
    expect(approvalResponse.ok(), await approvalResponse.text()).toBe(true);
    await page.reload();
    expect((await supabaseAdmin.from("provider_services").select("status").eq("id", providerService!.id).single()).data?.status).toBe("approved");

    await gotoAdmin("/admin/zones");
    const zoneRow = page.getByRole("listitem").filter({ hasText: zoneName });
    await zoneRow.getByRole("button", { name: /^coverage$/i }).click();
    await zoneRow.getByLabel(serviceName).click({ timeout: 15_000 });
    const providerCoverage = zoneRow.getByText("Providers serving this zone", { exact: true })
      .locator("..").getByRole("checkbox").first();
    await expect(providerCoverage).toBeEnabled({ timeout: 15_000 });
    await providerCoverage.click({ timeout: 15_000 });
    expect((await supabaseAdmin.from("zone_services").select("zone_id", { count: "exact", head: true }).eq("zone_id", zone!.id).eq("service_id", service!.id)).count).toBe(1);
    expect((await supabaseAdmin.from("zone_providers").select("zone_id", { count: "exact", head: true }).eq("zone_id", zone!.id).eq("provider_id", provider!.id)).count).toBe(1);

    await providerPage.goto("/pro/availability");
    await providerPage.getByRole("button", { name: /^mon$/i }).click();
    await providerPage.getByRole("button", { name: /save schedule/i }).click();
    await expect(providerPage.getByText(/saved/i, { exact: true })).toBeVisible();
    await providerPage.reload();
    expect((await supabaseAdmin.from("availability_rules").select("id", { count: "exact", head: true }).eq("provider_id", provider!.id)).count).toBeGreaterThan(0);

    await gotoAdmin(`/admin/provider/${provider!.id}`);
    await expect(page.getByText("Marketplace eligible: Yes")).toBeVisible();
    await expect(page.getByText("ELIGIBLE", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Marketplace eligible: Yes")).toBeVisible();

    await customerPage.goto("/search");
    await customerPage.getByLabel("Service").selectOption(service!.id);
    const providerLink = customerPage.locator(`a[href="/provider/${provider!.id}"]`);
    await expect(providerLink).toBeVisible();
    await providerLink.click();
    await expect(customerPage.getByText(providerProfile!.full_name || "QA_provider_e2e", { exact: true })).toBeVisible();
    await expect(customerPage.getByText(/Pro not found/i)).toHaveCount(0);
    await customerPage.reload();
    await expect(customerPage.getByText(providerProfile!.full_name || "QA_provider_e2e", { exact: true })).toBeVisible();

    const { data: address } = await supabaseAdmin.from("addresses").select("id").eq("user_id", customerUser.userId).eq("is_default", true).single();
    const { data: billing } = await supabaseAdmin.from("settings").select("value").eq("key", "billing").single();
    const platformFee = Number((billing!.value as any).platform_fee ?? 25);
    const vat = Math.round(100 * Number((billing!.value as any).vat_percent ?? 14) / 100);
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + ((8 - start.getUTCDay()) % 7 || 7));
    start.setUTCHours(10, 0, 0, 0);
    const bookingInsert = await supabaseAdmin.from("bookings").insert({
      customer_id: customerUser.userId, provider_id: provider!.id, service_id: service!.id, address_id: address!.id,
      start_at: start.toISOString(), end_at: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      status: "pending", notes: "QA_ Patch 2 recently booked route", price_subtotal: 100,
      price_total: 100 + platformFee + vat,
    }).select("id").single();
    expect(bookingInsert.error).toBeFalsy();
    bookingId = bookingInsert.data!.id;
    await customerPage.goto("/home");
    const recentProviderLink = customerPage.locator(`a[href="/provider/${provider!.id}"]`).last();
    await expect(recentProviderLink).toBeVisible();
    await recentProviderLink.click();
    await expect(customerPage.getByText(providerProfile!.full_name || "QA_provider_e2e", { exact: true })).toBeVisible();

    await gotoAdmin(`/admin/provider/${provider!.id}`);
    await page.getByRole("button", { name: /suspend provider/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /confirm suspend/i }).click();
    await customerPage.goto("/search");
    await customerPage.getByLabel("Service").selectOption(service!.id);
    await expect(customerPage.locator(`a[href="/provider/${provider!.id}"]`)).toHaveCount(0);
    await customerPage.reload();
    await expect(customerPage.locator(`a[href="/provider/${provider!.id}"]`)).toHaveCount(0);

    await page.getByRole("button", { name: /unsuspend provider/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /unsuspend provider/i }).click();
    await customerPage.goto("/search");
    await customerPage.getByLabel("Service").selectOption(service!.id);
    await expect(customerPage.locator(`a[href="/provider/${provider!.id}"]`)).toBeVisible();
    await customerPage.reload();
    await expect(customerPage.locator(`a[href="/provider/${provider!.id}"]`)).toBeVisible();

    const adminChecklist = await authenticatedClient("admin").rpc("provider_marketplace_eligibility", { p_provider_id: provider!.id, p_service_id: service!.id });
    expect(adminChecklist.error).toBeFalsy();
    expect(adminChecklist.data?.[0]).toMatchObject({
      identity_valid: true, account_active: true, verified: true, service_approved: true,
      service_active: true, price_valid: true, requirements_complete: true,
      evidence_approved: true, zone_covered: true, availability_valid: true,
      operational_clear: true, is_eligible: true,
    });
    expect(adminErrors.readErrors()).toEqual({ console: [], network: [] });
    expect(customerErrors.readErrors()).toEqual({ console: [], network: [] });
    expect(providerErrors.readErrors()).toEqual({ console: [], network: [] });
  } finally {
    await customerContext.close();
    await providerContext.close();
    if (bookingId) {
      await supabaseAdmin.from("bookings").update({ status: "cancelled", cancellation_reason: "QA_ Patch 2 cleanup" }).eq("id", bookingId);
      // Audit rows deliberately make historical bookings immutable. Keep this
      // explicitly tagged QA booking cancelled and neutralize its service below.
      expect((await supabaseAdmin.from("bookings").select("status").eq("id", bookingId).single()).data?.status).toBe("cancelled");
    }
    await supabaseAdmin.from("zone_providers").delete().eq("zone_id", zone!.id);
    await supabaseAdmin.from("zone_services").delete().eq("zone_id", zone!.id);
    await supabaseAdmin.from("zones").delete().eq("id", zone!.id);
    await supabaseAdmin.from("availability_rules").delete().eq("provider_id", provider!.id);
    await supabaseAdmin.from("provider_requirement_fulfillments").delete().eq("id", fulfillment!.id);
    await supabaseAdmin.from("provider_services").delete().eq("id", providerService!.id);
    await supabaseAdmin.from("service_requirements").delete().eq("id", requirement!.id);
    if (bookingId) {
      await supabaseAdmin.from("services").update({ is_active: false }).eq("id", service!.id);
      expect((await supabaseAdmin.from("services").select("is_active").eq("id", service!.id).single()).data?.is_active).toBe(false);
    } else {
      await supabaseAdmin.from("services").delete().eq("id", service!.id);
    }
    await supabaseAdmin.storage.from("provider-documents").remove([evidencePath]);
    await supabaseAdmin.from("providers").update({
      is_verified: provider!.is_verified, is_active: provider!.is_active, vacation_mode: provider!.vacation_mode,
    }).eq("id", provider!.id);
  }
});

test("marketplace authorization cannot be bypassed by anon, Customer, or Provider clients", async () => {
  const registry = readRegistry();
  const providerUser = registry.users.find((user: any) => user.key === "provider");
  const { data: provider } = await supabaseAdmin.from("providers").select("id").eq("profile_id", providerUser.userId).single();
  const anon = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "", { auth: { persistSession: false } });
  const customer = authenticatedClient("customer");
  const providerClient = authenticatedClient("provider");

  expect((await anon.rpc("provider_marketplace_eligibility", { p_provider_id: provider!.id })).error).toBeTruthy();
  expect((await customer.rpc("provider_marketplace_eligibility", { p_provider_id: provider!.id })).error?.code).toBe("42501");
  expect((await providerClient.rpc("search_marketplace_providers", {})).error?.code).toBe("42501");
  expect((await customer.from("providers").select("profile_id,hourly_rate").eq("id", provider!.id)).data).toEqual([]);
  expect((await customer.from("provider_documents").select("storage_path").eq("provider_id", provider!.id)).data).toEqual([]);
  const forbiddenApproval = await customer.rpc("admin_set_provider_verification", { p_provider_id: provider!.id, p_verified: true });
  expect(forbiddenApproval.error?.code).toBe("42501");
});
