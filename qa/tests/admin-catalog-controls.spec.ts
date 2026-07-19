import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";
import { captureErrors } from "./helpers";
import {
  assertSafeGlobalMutationTarget,
  registerRestoration,
  restoreRestoration,
} from "../restoration-registry.mjs";
import { authenticatedClient } from "../authenticated-client.mjs";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

async function assertClean(page: Page, readErrors: ReturnType<typeof captureErrors>["readErrors"]) {
  await page.waitForLoadState("networkidle");
  const errors = readErrors();
  expect(errors.console).toEqual([]);
  expect(errors.network.filter((entry) => !entry.includes("favicon"))).toEqual([]);
}

async function createPaymentMethod(page: Page, code: string, name: string) {
  await page.getByRole("button", { name: /^new method$/i }).click();
  await page.getByLabel(/^code$/i).fill(code);
  await page.getByLabel(/^english name$/i).fill(name);
  await page.getByLabel(/^arabic name$/i).fill(`QA_ ${name} ar`);
  const submit = page.getByRole("button", { name: /^create method$/i });
  await expect(submit).toBeEnabled();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rest/v1/payment_methods") && response.request().method() === "POST"),
    submit.click(),
  ]);
  await expect(page.getByText(name)).toBeVisible();
}

test("payment method edit, activation, default, and ordering persist", async ({ page }, testInfo) => {
  test.slow();
  assertSafeGlobalMutationTarget(testInfo.project.use.baseURL);
  const { readErrors } = captureErrors(page);
  const suffix = Date.now();
  const codeA = `qa_pm_a_${suffix}`;
  const codeB = `qa_pm_b_${suffix}`;
  const nameA = `QA_ payment A ${suffix}`;
  const nameB = `QA_ payment B ${suffix}`;
  const { data: originalDefaults, error: defaultsError } = await supabaseAdmin.from("payment_methods").select("id,is_default").order("id");
  expect(defaultsError).toBeNull();
  expect(originalDefaults, "payment default state must be snapshotted before mutation").toBeTruthy();
  const restorationId = `payment-defaults-${suffix}`;
  registerRestoration({ id: restorationId, type: "payment_defaults", rows: originalDefaults });
  let createdIds: string[] = [];

  try {
    await page.goto("/admin/payment-methods");
    await createPaymentMethod(page, codeA, nameA);
    await createPaymentMethod(page, codeB, nameB);

  let rowA = page.getByRole("listitem").filter({ hasText: codeA });
  let rowB = page.getByRole("listitem").filter({ hasText: codeB });
  await rowA.getByRole("button", { name: /^edit$/i }).click();
  rowA = page.locator(`input[value="${codeA}"]`).locator("xpath=ancestor::li[1]");
  await rowA.getByLabel(/^english name$/i).fill(`${nameA} edited`);
  await rowA.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText(`${nameA} edited`)).toBeVisible();

  rowB = page.getByRole("listitem").filter({ hasText: codeB });
  await rowB.getByRole("button", { name: /set default/i }).click();
  const defaultDialog = page.getByRole("dialog");
  await defaultDialog.getByRole("button", { name: /set default/i }).click();
  await expect(rowB).toContainText(/default/i);

  const moveUp = rowB.getByRole("button", { name: /move up/i });
  await expect(moveUp).toBeEnabled();
  await moveUp.click();
  await expect(moveUp).toBeEnabled();

  rowA = page.getByRole("listitem").filter({ hasText: codeA });
  await rowA.getByRole("button", { name: /^deactivate$/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^deactivate$/i }).click();
  await expect(rowA).toContainText(/inactive/i);
  await rowA.getByRole("button", { name: /^activate$/i }).click();

  await page.waitForLoadState("networkidle");
  await page.reload();
  const { data: stored } = await supabaseAdmin
    .from("payment_methods")
    .select("id,code,name_en,is_active,is_default,display_order")
    .in("code", [codeA, codeB])
    .order("display_order");
  const storedA = stored!.find((method) => method.code === codeA)!;
  const storedB = stored!.find((method) => method.code === codeB)!;
  createdIds = [storedA.id, storedB.id];
  expect(storedA).toMatchObject({ name_en: `${nameA} edited`, is_active: true });
  expect(storedB.is_default).toBe(true);
  expect(storedB.display_order).toBeLessThan(storedA.display_order);
  const beforeFailedSwap = stored!.map(({ id, display_order }) => ({ id, display_order }));
  const { error: forcedFailure } = await authenticatedClient("admin").rpc("admin_swap_payment_method_order", {
    p_first_id: storedA.id,
    p_second_id: "00000000-0000-0000-0000-000000000000",
  });
  expect(forcedFailure, "a missing swap target must fail").toBeTruthy();
  const { data: afterFailedSwap } = await supabaseAdmin.from("payment_methods").select("id,display_order").in("id", [storedA.id, storedB.id]).order("display_order");
  expect(afterFailedSwap).toEqual(beforeFailedSwap);
  const { error: customerDenied } = await authenticatedClient("customer").rpc("admin_swap_payment_method_order", {
    p_first_id: storedA.id,
    p_second_id: storedB.id,
  });
  expect(customerDenied?.code).toBe("42501");
  const { data: afterDeniedSwap } = await supabaseAdmin.from("payment_methods").select("id,display_order").in("id", [storedA.id, storedB.id]).order("display_order");
  expect(afterDeniedSwap).toEqual(beforeFailedSwap);
  const { count: auditCount } = await supabaseAdmin
    .from("audit_logs")
    .select("id", { head: true, count: "exact" })
    .eq("entity", "payment_methods")
    .in("entity_id", [storedA.id, storedB.id]);
  expect(auditCount).toBeGreaterThanOrEqual(7);
  await assertClean(page, readErrors);
  } finally {
    await restoreRestoration(restorationId);
    if (createdIds.length) await supabaseAdmin.from("payment_methods").delete().in("id", createdIds);
    else await supabaseAdmin.from("payment_methods").delete().in("code", [codeA, codeB]);
    const { data: restoredDefaults } = await supabaseAdmin.from("payment_methods").select("id").eq("is_default", true).order("id");
    expect(restoredDefaults?.map((row) => row.id)).toEqual(originalDefaults!.filter((row) => row.is_default).map((row) => row.id));
  }
});

test("service pricing, activation, and requirement controls persist", async ({ page }) => {
  test.slow();
  const { readErrors } = captureErrors(page);
  const suffix = Date.now();
  const slug = `qa-admin-service-${suffix}`;
  const serviceName = `QA_ admin service ${suffix}`;
  const requirementName = `QA_ requirement ${suffix}`;
  const secondRequirementName = `QA_ requirement second ${suffix}`;

  await page.goto("/admin/services");
  const newService = page.getByRole("button", { name: /^new service$/i });
  await expect(newService).toBeEnabled({ timeout: 20_000 });
  await newService.click();
  const createForm = page.locator("section", { has: page.getByRole("heading", { name: /^new service$/i }) });
  await createForm.getByLabel(/^english name$/i).fill(serviceName);
  await createForm.getByLabel(/^arabic name$/i).fill("QA_ service ar");
  await createForm.getByLabel(/^slug$/i).fill(slug);
  await createForm.getByLabel(/base price/i).fill("120");
  await createForm.getByLabel(/duration/i).fill("45");
  await createForm.getByRole("button", { name: /^create service$/i }).click();
  await expect(page.getByText(serviceName)).toBeVisible();

  let serviceCard = page.getByRole("listitem").filter({ hasText: serviceName }).first();
  await serviceCard.getByRole("button", { name: /^edit$/i }).first().click();
  serviceCard = page.locator(`input[value="${slug}"]`).locator("xpath=ancestor::li[1]");
  await serviceCard.getByLabel(/minimum price/i).fill("100");
  await serviceCard.getByLabel(/maximum price/i).fill("250");
  await serviceCard.getByLabel(/max.*extras/i).fill("50");
  await serviceCard.getByRole("button", { name: /^save$/i }).first().click();
  serviceCard = page.getByRole("listitem").filter({ hasText: serviceName }).first();

  await serviceCard.getByRole("button", { name: /add requirement/i }).click();
  await serviceCard.getByPlaceholder(/code/i).fill(`qa_req_${suffix}`);
  await serviceCard.getByPlaceholder(/^english name$/i).fill(requirementName);
  await serviceCard.getByPlaceholder(/^arabic name$/i).fill("QA_ requirement ar");
  await serviceCard.getByRole("button", { name: /^add$/i }).click();
  await expect(serviceCard.getByText(requirementName)).toBeVisible();

  const { data: service } = await supabaseAdmin.from("services").select("*").eq("slug", slug).single();
  const { data: firstRequirement } = await supabaseAdmin.from("service_requirements").select("*").eq("service_id", service!.id).eq("name_en", requirementName).single();
  const { data: secondRequirement } = await supabaseAdmin.from("service_requirements").insert({
    service_id: service!.id,
    code: `qa_req_second_${suffix}`,
    name_en: secondRequirementName,
    name_ar: "QA_ requirement second ar",
    requirement_type: "other",
    required_for_provider_approval: false,
    required_during_booking: false,
    fulfillment_mode: "provider",
    provider_extra_fee: 0,
    evidence_required: false,
    is_active: true,
    sort_order: firstRequirement!.sort_order + 1,
  }).select().single();

  await page.reload();
  serviceCard = page.getByRole("listitem").filter({ hasText: serviceName }).first();
  let requirementRow = serviceCard.getByRole("listitem").filter({ hasText: requirementName });
  await requirementRow.getByRole("button", { name: /^edit$/i }).click();
  requirementRow = page.locator(`input[value="qa_req_${suffix}"]`).locator("xpath=ancestor::li[1]");
  await requirementRow.getByPlaceholder(/^english name$/i).fill(`${requirementName} edited`);
  await requirementRow.getByRole("button", { name: /^save$/i }).click();
  requirementRow = serviceCard
    .getByRole("listitem")
    .filter({ has: page.getByText(`${requirementName} edited`, { exact: true }) })
    .last();
  await requirementRow.getByRole("button", { name: /^deactivate$/i }).click();
  await expect(requirementRow).toContainText(/inactive/i);
  await requirementRow.getByRole("button", { name: /move down/i }).click();

  let serviceHeader = serviceCard.locator(":scope > div").first();
  await serviceHeader.getByRole("button", { name: /^deactivate$/i }).click();
  await serviceCard.locator('div[class*="border-coral/40"]').getByRole("button", { name: /^deactivate$/i }).click();
  await expect(serviceCard).toContainText(/inactive/i);
  serviceHeader = serviceCard.locator(":scope > div").first();
  await serviceHeader.getByRole("button", { name: /^activate$/i }).click();

  await page.waitForLoadState("networkidle");
  await page.reload();
  const { data: storedService } = await supabaseAdmin.from("services").select("*").eq("id", service!.id).single();
  expect(storedService).toMatchObject({
    minimum_price: 100,
    maximum_price: 250,
    maximum_extras_total: 50,
    is_active: true,
  });
  const { data: storedRequirements } = await supabaseAdmin
    .from("service_requirements")
    .select("id,name_en,is_active,sort_order")
    .in("id", [firstRequirement!.id, secondRequirement!.id])
    .order("sort_order");
  expect(storedRequirements![0].id).toBe(secondRequirement!.id);
  expect(storedRequirements![1]).toMatchObject({ id: firstRequirement!.id, name_en: `${requirementName} edited`, is_active: false });
  const requirementOrder = storedRequirements!.map(({ id, sort_order }) => ({ id, sort_order }));
  const { error: failedRequirementSwap } = await authenticatedClient("admin").rpc("admin_swap_service_requirement_order", {
    p_first_id: firstRequirement!.id,
    p_second_id: "00000000-0000-0000-0000-000000000000",
  });
  expect(failedRequirementSwap, "a missing requirement target must fail atomically").toBeTruthy();
  const { data: unchangedRequirements } = await supabaseAdmin.from("service_requirements").select("id,sort_order").in("id", [firstRequirement!.id, secondRequirement!.id]).order("sort_order");
  expect(unchangedRequirements).toEqual(requirementOrder);
  const { count: serviceAudits } = await supabaseAdmin.from("audit_logs").select("id", { head: true, count: "exact" }).eq("entity", "services").eq("entity_id", service!.id);
  expect(serviceAudits).toBeGreaterThanOrEqual(4);
  await assertClean(page, readErrors);

  await supabaseAdmin.from("service_requirements").delete().in("id", [firstRequirement!.id, secondRequirement!.id]);
  await supabaseAdmin.from("services").delete().eq("id", service!.id);
});

test("promo edit and activation persist without a silent scope write", async ({ page }) => {
  const { readErrors } = captureErrors(page);
  const code = `QA_ADMIN_PROMO_${Date.now()}`;
  await page.goto("/admin/promo-codes");
  await page.getByRole("button", { name: /^new promo code$/i }).click();
  await page.getByLabel(/^code$/i).fill(code);
  await page.getByLabel(/discount \(egp\)|discount value|fixed amount/i).first().fill("15");
  await page.getByRole("button", { name: /^create promo code$/i }).click();
  let row = page.getByRole("listitem").filter({ hasText: code });
  await row.getByRole("button", { name: /^edit$/i }).click();
  row = page.locator(`input[value="${code}"]`).locator("xpath=ancestor::li[1]");
  const description = `QA_ promo edited ${Date.now()}`;
  await row.getByLabel(/english description/i).fill(description);
  await row.getByRole("button", { name: /^save$/i }).click();
  row = page.getByRole("listitem").filter({ hasText: code });
  await expect(row).toContainText(description);
  await row.getByRole("button", { name: /^deactivate$/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^deactivate$/i }).click();
  await expect(row).toContainText(/inactive/i);
  await row.getByRole("button", { name: /^activate$/i }).click();
  await page.waitForLoadState("networkidle");
  await page.reload();

  const { data: stored } = await supabaseAdmin.from("promo_codes").select("*").eq("code", code).single();
  expect(stored).toMatchObject({ description_en: description, is_active: true });
  const { count } = await supabaseAdmin.from("audit_logs").select("id", { head: true, count: "exact" }).eq("entity", "promo_codes").eq("entity_id", stored!.id);
  expect(count).toBeGreaterThanOrEqual(4);
  await assertClean(page, readErrors);
  await supabaseAdmin.from("promo_codes").delete().eq("id", stored!.id);
});

test("zone edit, activation, and service/provider coverage persist", async ({ page }) => {
  test.slow();
  const { readErrors } = captureErrors(page);
  const suffix = Date.now();
  const name = `QA_zone_controls_${suffix}`;
  const { data: zone } = await supabaseAdmin.from("zones").insert({
    name_en: name,
    name_ar: "QA zone controls ar",
    boundary_type: "circle",
    center_lat: 30.05,
    center_lng: 31.0,
    radius_km: 2,
    travel_fee: 5,
    is_active: true,
  }).select().single();
  const { data: service } = await supabaseAdmin.from("services").select("id,name_en").eq("is_active", true).limit(1).single();
  const providerUser = readRegistry().users.find((user: any) => user.key === "provider");
  const { data: provider } = await supabaseAdmin.from("providers").select("id,is_verified,is_active").eq("profile_id", providerUser.userId).single();
  await supabaseAdmin.from("providers").update({ is_verified: true, is_active: true }).eq("id", provider!.id);

  await page.goto("/admin/zones");
  let row = page.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: /^edit$/i }).click();
  row = page.locator(`input[value="${name}"]`).locator("xpath=ancestor::li[1]");
  await row.getByLabel(/travel fee/i).fill("17");
  await row.getByRole("button", { name: /^save$/i }).click();
  row = page.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: /^deactivate$/i }).click();
  await expect(row).toContainText(/inactive/i);
  await row.getByRole("button", { name: /^activate$/i }).click();
  await row.getByRole("button", { name: /^coverage$/i }).click();
  const serviceCheckbox = row.getByLabel(service!.name_en);
  const providerCheckbox = row.getByLabel("QA_provider_e2e");
  await expect(serviceCheckbox).toBeEnabled();
  await serviceCheckbox.click();
  await expect(serviceCheckbox).toBeChecked();
  await expect(providerCheckbox).toBeEnabled();
  const [providerCoverageResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rest/v1/zone_providers") && response.request().method() === "POST"),
    providerCheckbox.click(),
  ]);
  expect(
    providerCoverageResponse.ok(),
    `provider coverage failed: ${providerCoverageResponse.status()} ${await providerCoverageResponse.text()}`,
  ).toBe(true);
  await expect(providerCheckbox).toBeChecked();
  await page.waitForLoadState("networkidle");
  await page.reload();

  const { data: stored } = await supabaseAdmin.from("zones").select("travel_fee,is_active").eq("id", zone!.id).single();
  expect(stored).toMatchObject({ travel_fee: 17, is_active: true });
  const { count: serviceCoverage } = await supabaseAdmin.from("zone_services").select("zone_id", { count: "exact", head: true }).eq("zone_id", zone!.id).eq("service_id", service!.id);
  const { count: providerCoverage } = await supabaseAdmin.from("zone_providers").select("zone_id", { count: "exact", head: true }).eq("zone_id", zone!.id).eq("provider_id", provider!.id);
  expect(serviceCoverage).toBe(1);
  expect(providerCoverage).toBe(1);
  const { count: audits } = await supabaseAdmin.from("audit_logs").select("id", { count: "exact", head: true }).eq("entity", "zones").eq("entity_id", zone!.id);
  expect(audits).toBeGreaterThanOrEqual(3);
  await assertClean(page, readErrors);

  await supabaseAdmin.from("zone_services").delete().eq("zone_id", zone!.id);
  await supabaseAdmin.from("zone_providers").delete().eq("zone_id", zone!.id);
  await supabaseAdmin.from("zones").delete().eq("id", zone!.id);
  await supabaseAdmin.from("providers").update({ is_verified: provider!.is_verified, is_active: provider!.is_active }).eq("id", provider!.id);
});
