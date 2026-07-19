import { test, expect } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";
import { captureErrors } from "./helpers";
import { assertSafeGlobalMutationTarget } from "../restoration-registry.mjs";
import { authenticatedClient } from "../authenticated-client.mjs";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

test("booking status selector rejects zero-row writes, persists, and audits the Admin write", async ({ page }) => {
  const registry = readRegistry();
  const admin = registry.users.find((user: any) => user.key === "adminSeed");
  const customer = registry.users.find((user: any) => user.key === "customer");
  const { data: services } = await supabaseAdmin.from("services").select("id").eq("is_active", true);
  const { data: mandatoryRequirements } = await supabaseAdmin.from("service_requirements").select("service_id,required_for_provider_approval,required_during_booking").eq("is_active", true);
  const blockedServices = new Set((mandatoryRequirements ?? []).filter((row) => row.required_for_provider_approval || row.required_during_booking).map((row) => row.service_id));
  const service = services!.find((row) => !blockedServices.has(row.id));
  expect(service, "a service without mandatory provider requirements is required for the fixture").toBeTruthy();
  const { data: provider, error: providerError } = await supabaseAdmin.from("providers").insert({
    profile_id: admin.userId,
    bio_en: "QA_ Admin status-selector provider",
    hourly_rate: 100,
    max_advance_days: 365,
    is_active: true,
    is_verified: true,
  }).select().single();
  expect(providerError).toBeNull();
  const { data: providerService, error: providerServiceError } = await supabaseAdmin.from("provider_services").insert({
    provider_id: provider!.id,
    service_id: service!.id,
    status: "pending",
  }).select().single();
  expect(providerServiceError).toBeNull();
  const { error: approveFixtureError } = await authenticatedClient("admin").rpc("admin_set_provider_service_status", {
    p_id: providerService!.id,
    p_status: "approved",
  });
  expect(approveFixtureError).toBeNull();
  const { data: zone, error: zoneError } = await supabaseAdmin.from("zones").insert({
    name_en: `QA_status_selector_zone_${Date.now()}`,
    name_ar: "QA status selector zone",
    boundary_type: "circle",
    center_lat: 30.05,
    center_lng: 31.0,
    radius_km: 5,
    travel_fee: 0,
    is_active: true,
  }).select().single();
  expect(zoneError).toBeNull();
  const { error: zoneServiceError } = await supabaseAdmin.from("zone_services").insert({ zone_id: zone!.id, service_id: service!.id });
  expect(zoneServiceError).toBeNull();
  const { error: zoneProviderError } = await supabaseAdmin.from("zone_providers").insert({ zone_id: zone!.id, provider_id: provider!.id });
  expect(zoneProviderError).toBeNull();
  const { data: address, error: addressError } = await supabaseAdmin.from("addresses").insert({
    user_id: customer.userId,
    label: "other",
    custom_label: "QA_ status selector",
    line1: "QA_ synthetic address",
    city: "Sheikh Zayed",
    lat: 30.05,
    lng: 31.0,
  }).select().single();
  expect(addressError).toBeNull();
  const { data: billing } = await supabaseAdmin.from("settings").select("value").eq("key", "billing").single();
  const platformFee = Number((billing!.value as any).platform_fee ?? 25);
  const vat = Math.round(100 * Number((billing!.value as any).vat_percent ?? 14) / 100);
  const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const { data: availability, error: availabilityError } = await supabaseAdmin.from("availability_rules").insert({
    provider_id: provider!.id,
    weekday: start.getUTCDay(),
    start_time: "00:00",
    end_time: "23:59",
    timezone: "Africa/Cairo",
  }).select().single();
  expect(availabilityError).toBeNull();
  const { data: booking, error } = await supabaseAdmin.from("bookings").insert({
    customer_id: customer.userId,
    address_id: address!.id,
    provider_id: provider!.id,
    service_id: service!.id,
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    status: "pending",
    notes: "QA_ Admin status-selector fixture",
    price_subtotal: 100,
    price_total: 100 + platformFee + vat,
  }).select("id,status").single();
  expect(error).toBeNull();
  const { readErrors } = captureErrors(page, {
    allowHttpErrors: [{ status: 406, method: "PATCH", url: "/rest/v1/bookings" }],
  });

  try {
    await page.goto("/admin/bookings?status=pending");
    const row = page.getByRole("listitem").filter({ hasText: booking!.id });
    const statusSelector = row.locator("select").first();
    await expect(statusSelector).toHaveValue("pending");

    await page.route("**/rest/v1/bookings*", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await route.continue({ url: route.request().url().replace(booking!.id, "00000000-0000-0000-0000-000000000000") });
    });
    const [zeroRowResponse] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/rest/v1/bookings")),
      statusSelector.selectOption("confirmed"),
    ]);
    expect(zeroRowResponse.status()).toBe(406);
    const { data: unchanged } = await supabaseAdmin.from("bookings").select("status").eq("id", booking!.id).single();
    expect(unchanged!.status).toBe("pending");
    await expect(statusSelector).toHaveValue("pending");
    await page.unroute("**/rest/v1/bookings*");

    const { count: beforeAudits } = await supabaseAdmin.from("audit_logs").select("id", { count: "exact", head: true })
      .eq("entity", "bookings").eq("entity_id", booking!.id).eq("action", "UPDATE").eq("actor_id", admin.userId);
    const [successResponse] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/rest/v1/bookings")),
      statusSelector.selectOption("confirmed"),
    ]);
    expect(successResponse.ok(), await successResponse.text()).toBe(true);
    await page.goto("/admin/bookings?status=confirmed");
    const persistedRow = page.getByRole("listitem").filter({ hasText: booking!.id });
    await expect(persistedRow.locator("select").first()).toHaveValue("confirmed");
    const { data: stored } = await supabaseAdmin.from("bookings").select("status").eq("id", booking!.id).single();
    expect(stored!.status).toBe("confirmed");
    const { data: auditRows, count: afterAudits } = await supabaseAdmin.from("audit_logs").select("id,new_values", { count: "exact" })
      .eq("entity", "bookings").eq("entity_id", booking!.id).eq("action", "UPDATE").eq("actor_id", admin.userId)
      .order("created_at", { ascending: false });
    expect(afterAudits).toBe((beforeAudits ?? 0) + 1);
    expect((auditRows![0].new_values as any).status).toBe("confirmed");
    await page.waitForLoadState("networkidle");
    const runtimeErrors = readErrors();
    expect(runtimeErrors.console).toEqual([]);
    expect(runtimeErrors.network).toEqual([]);
  } finally {
    await page.unroute("**/rest/v1/bookings*").catch(() => {});
    await supabaseAdmin.from("bookings").update({ status: "cancelled", cancellation_reason: "QA_ fixture cleanup" }).eq("id", booking!.id);
    await supabaseAdmin.from("bookings").delete().eq("id", booking!.id);
    await supabaseAdmin.from("addresses").delete().eq("id", address!.id);
    await supabaseAdmin.from("zone_providers").delete().eq("zone_id", zone!.id);
    await supabaseAdmin.from("zone_services").delete().eq("zone_id", zone!.id);
    await supabaseAdmin.from("zones").delete().eq("id", zone!.id);
    await supabaseAdmin.from("provider_services").delete().eq("id", providerService!.id);
    await supabaseAdmin.from("availability_rules").delete().eq("id", availability!.id);
    await supabaseAdmin.from("providers").delete().eq("id", provider!.id);
  }
});

test("service-area optimistic toggle rolls back after a failed save", async ({ page }, testInfo) => {
  assertSafeGlobalMutationTarget(testInfo.project.use.baseURL);
  const { data: before } = await supabaseAdmin.from("settings").select("value").eq("key", "service_areas").single();
  const originalValue = before!.value;
  const firstArea = (originalValue as any).areas[0];
  const { readErrors } = captureErrors(page, {
    allowHttpErrors: [{ status: 500, method: "POST", url: "/rest/v1/settings?on_conflict=key" }],
  });
  await page.route("**/rest/v1/settings?on_conflict=key*", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "QA_ forced settings failure" }) });
    } else await route.continue();
  });
  await page.goto("/admin/settings");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: /service areas/i }) });
  const row = section.getByRole("listitem").filter({ hasText: firstArea.name });
  const button = row.getByRole("button", { name: firstArea.enabled ? /^disable$/i : /^enable$/i });
  const originalLabel = firstArea.enabled ? "Disable" : "Enable";
  const [failedResponse] = await Promise.all([
    page.waitForResponse((response) => response.status() === 500 && response.url().includes("/rest/v1/settings")),
    button.click(),
  ]);
  expect(failedResponse.status()).toBe(500);
  await expect(row.getByRole("button", { name: new RegExp(`^${originalLabel}$`, "i") })).toBeVisible();
  await expect(page.getByText(/QA_ forced settings failure/i)).toBeVisible();
  const { data: after } = await supabaseAdmin.from("settings").select("value").eq("key", "service_areas").single();
  expect(after!.value).toEqual(originalValue);
  await page.waitForLoadState("networkidle");
  const runtimeErrors = readErrors();
  expect(runtimeErrors.console).toEqual([]);
  expect(runtimeErrors.network).toEqual([]);
});

test("Admin Overview exposes a failed pending-provider query and retries", async ({ page }) => {
  const { readErrors } = captureErrors(page, {
    allowHttpErrors: [{ status: 400, method: "GET", url: "/rest/v1/providers" }],
  });
  await page.route("**/rest/v1/providers*", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "QA_ forced provider read failure" }) });
    } else await route.continue();
  });
  await page.goto("/admin");
  await expect(page.getByText(/could not load providers/i)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("button", { name: /try again/i })).toBeVisible({ timeout: 25_000 });
  await page.unroute("**/rest/v1/providers*");
  await page.getByRole("button", { name: /try again/i }).click();
  await expect(page.getByText(/could not load providers/i)).toHaveCount(0);
  await expect(page.getByText(/pending providers/i).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const runtimeErrors = readErrors();
  expect(runtimeErrors.console).toEqual([]);
  expect(runtimeErrors.network).toEqual([]);
});
