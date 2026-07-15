import { test, expect } from "@playwright/test";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../admin-client.mjs";
import { loadEnv } from "../env.mjs";
import { readRegistry } from "../registry.mjs";

loadEnv();
test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

test("eligible provider appears in customer search; ineligible does not", async ({ page }) => {
  // The QA provider fixture (global-setup) signed up and completed onboarding
  // for real, but has no service/zone yet — not eligible.
  const registry = readRegistry();
  const providerEntry = registry.users.find((u: any) => u.key === "provider");
  expect(providerEntry, "provider fixture should be registered").toBeTruthy();

  const { data: provider } = await supabaseAdmin.from("providers").select("id").eq("profile_id", providerEntry!.userId).single();
  expect(provider).toBeTruthy();
  const providerId = provider!.id;

  const anon = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "");

  // 1) Not eligible yet: unverified, no service.
  const beforeCheck = await anon.from("eligible_providers").select("id").eq("id", providerId).maybeSingle();
  expect(beforeCheck.data, "provider should not be eligible before setup").toBeNull();

  // 2) Real admin action: approve provider verification via the actual UI.
  await page.goto(`/admin/provider/${providerId}`);
  await page.getByRole("button", { name: /^approve$/i }).first().click();
  await expect(page.getByText(/verified/i).first()).toBeVisible({ timeout: 10_000 });

  // 3) Give it one approved, in-range-priced, zone-covered, requirement-free service.
  // (Requesting/approving a specific service is a separate UI flow already
  // covered by admin write tests; here we seed the supporting fixture data
  // and drive only the approval action, which is what's under test.)
  const { data: service } = await supabaseAdmin.from("services").select("id, base_price").eq("is_active", true).limit(1).single();
  const { data: ps } = await supabaseAdmin.from("provider_services").insert({ provider_id: providerId, service_id: service!.id, status: "pending" }).select().single();

  const { data: zone } = await supabaseAdmin.from("zones").insert({
    name_en: "QA_eligibility_zone", name_ar: "QA_منطقة_أهلية", boundary_type: "polygon", is_active: true,
    polygon: [{ lat: 30.0, lng: 31.0 }, { lat: 30.0, lng: 31.05 }, { lat: 30.03, lng: 31.02 }],
  }).select().single();
  await supabaseAdmin.from("zone_services").insert({ zone_id: zone!.id, service_id: service!.id });
  await supabaseAdmin.from("zone_providers").insert({ zone_id: zone!.id, provider_id: providerId });

  await page.reload();
  await page.getByRole("button", { name: /^approve$/i }).first().click();
  await expect(page.getByText(service!.base_price != null ? /approved/i : /approved/i).first()).toBeVisible({ timeout: 10_000 });

  // 4) Now eligible, and visible through the real customer-facing gate.
  const afterCheck = await anon.from("eligible_providers").select("id").eq("id", providerId).maybeSingle();
  expect(afterCheck.data?.id, "provider should be eligible after verification + approved zone-covered service").toBe(providerId);

  const { data: eligDetail } = await supabaseAdmin.rpc("provider_eligibility", { p_provider_id: providerId });
  expect(eligDetail?.[0]?.is_eligible).toBe(true);

  // cleanup QA fixture rows this test created directly (provider account itself
  // is cleaned by global-teardown).
  await supabaseAdmin.from("zone_providers").delete().eq("zone_id", zone!.id);
  await supabaseAdmin.from("zone_services").delete().eq("zone_id", zone!.id);
  await supabaseAdmin.from("zones").delete().eq("id", zone!.id);
  await supabaseAdmin.from("provider_services").delete().eq("id", ps!.id);
});
