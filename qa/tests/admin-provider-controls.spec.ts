import { test, expect } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";
import { captureErrors } from "./helpers";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

test("provider rejection, verification, suspension, and service review persist", async ({ page }) => {
  test.slow();
  const { readErrors } = captureErrors(page, {
    allowHttpErrors: [{ status: 400, method: "POST", url: "/rest/v1/rpc/admin_set_provider_service_status" }],
  });
  const suffix = Date.now();
  const providerUser = readRegistry().users.find((user: any) => user.key === "provider");
  const { data: provider, error: providerError } = await supabaseAdmin.from("providers").select("id,is_verified,is_active").eq("profile_id", providerUser.userId).single();
  expect(providerError).toBeNull();
  const originalProviderState = { is_verified: provider!.is_verified, is_active: provider!.is_active };
  await supabaseAdmin.from("providers").update({ is_verified: false, is_active: false }).eq("id", provider!.id);
  const { data: category, error: categoryError } = await supabaseAdmin.from("categories").select("id").eq("is_active", true).limit(1).single();
  expect(categoryError).toBeNull();
  const { data: service, error: serviceError } = await supabaseAdmin.from("services").insert({
    category_id: category!.id,
    slug: `qa-provider-review-${suffix}`,
    name_en: `QA_ provider review ${suffix}`,
    name_ar: "QA provider review ar",
    base_price: 100,
    duration_min: 60,
    pricing_model: "fixed",
    is_active: true,
  }).select().single();
  expect(serviceError).toBeNull();
  const { data: initialProviderService, error: providerServiceError } = await supabaseAdmin.from("provider_services").insert({
    provider_id: provider!.id,
    service_id: service!.id,
    status: "pending",
  }).select().single();
  expect(providerServiceError).toBeNull();
  let providerService = initialProviderService!;
  const { data: requirement, error: requirementError } = await supabaseAdmin.from("service_requirements").insert({
    service_id: service!.id,
    code: `qa_mandatory_${suffix}`,
    name_en: `QA_ mandatory ${suffix}`,
    name_ar: "QA mandatory ar",
    requirement_type: "certification",
    required_for_provider_approval: true,
    required_during_booking: false,
    fulfillment_mode: "provider",
    provider_extra_fee: 0,
    evidence_required: false,
    is_active: true,
    sort_order: 1,
  }).select().single();
  expect(requirementError).toBeNull();

  await page.goto(`/admin/provider/${provider!.id}`);
  await page.getByRole("button", { name: /^reject$/i }).last().click();
  const rejectDialog = page.getByRole("dialog");
  const confirmReject = rejectDialog.getByRole("button", { name: /confirm reject/i });
  await expect(confirmReject).toBeDisabled();
  await rejectDialog.locator("textarea").fill("QA_ incomplete application");
  const [rejectResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rpc/admin_set_provider_verification") && response.request().method() === "POST"),
    confirmReject.click(),
  ]);
  expect(rejectResponse.ok(), `provider rejection should succeed: ${rejectResponse.status()} ${await rejectResponse.text().catch(() => "")}`).toBe(true);
  await expect(rejectDialog).toHaveCount(0);
  let storedProvider = await supabaseAdmin.from("providers").select("is_verified,is_active").eq("id", provider!.id).single();
  expect(storedProvider.data).toMatchObject({ is_verified: false, is_active: false });

  const [approveProviderResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rpc/admin_set_provider_verification") && response.request().method() === "POST"),
    page.getByRole("button", { name: /^approve$/i }).last().click(),
  ]);
  expect(approveProviderResponse.ok(), `provider approval should succeed: ${approveProviderResponse.status()} ${await approveProviderResponse.text().catch(() => "")}`).toBe(true);
  storedProvider = await supabaseAdmin.from("providers").select("is_verified,is_active").eq("id", provider!.id).single();
  expect(storedProvider.data).toMatchObject({ is_verified: true, is_active: true });

  let serviceRow = page.getByRole("listitem").filter({ hasText: service!.name_en });
  const [blockedApprovalResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rpc/admin_set_provider_service_status") && response.request().method() === "POST"),
    serviceRow.getByRole("button", { name: /^approve$/i }).click(),
  ]);
  expect(blockedApprovalResponse.status()).toBe(400);
  await expect(page.getByText(/mandatory|required|requirement/i).last()).toBeVisible();
  const { data: stillPending } = await supabaseAdmin.from("provider_services").select("status").eq("id", providerService!.id).single();
  expect(stillPending!.status).toBe("pending");

  await serviceRow.getByRole("button", { name: /^reject$/i }).click();
  const serviceConfirm = serviceRow.getByRole("button", { name: /confirm reject/i });
  await expect(serviceConfirm).toBeDisabled();
  await serviceRow.getByLabel(/rejection reason/i).fill("QA_ service evidence rejected");
  const [rejectServiceResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rpc/admin_set_provider_service_status") && response.request().method() === "POST"),
    serviceConfirm.click(),
  ]);
  expect(rejectServiceResponse.ok(), `provider-service rejection should succeed: ${rejectServiceResponse.status()} ${await rejectServiceResponse.text().catch(() => "")}`).toBe(true);
  await page.reload();
  const { data: rejectedService } = await supabaseAdmin.from("provider_services").select("status,rejection_reason").eq("id", providerService.id).single();
  expect(rejectedService).toMatchObject({ status: "rejected", rejection_reason: "QA_ service evidence rejected" });
  const rejectedProviderServiceId = providerService.id;

  const { error: deleteRejectedError } = await supabaseAdmin.from("provider_services").delete().eq("id", rejectedProviderServiceId);
  expect(deleteRejectedError).toBeNull();
  const { data: replacementProviderService, error: replacementError } = await supabaseAdmin.from("provider_services").insert({
    provider_id: provider!.id,
    service_id: service!.id,
    status: "pending",
  }).select().single();
  expect(replacementError).toBeNull();
  providerService = replacementProviderService!;

  const { data: fulfillment, error: fulfillmentError } = await supabaseAdmin.from("provider_requirement_fulfillments").insert({
    provider_id: provider!.id,
    requirement_id: requirement!.id,
    status: "pending",
    notes: "QA_ pending provider requirement",
  }).select().single();
  expect(fulfillmentError).toBeNull();
  await page.goto("/admin/services");
  const reviewServiceCard = page.getByRole("listitem").filter({ hasText: service!.name_en });
  const reviewRequirementRow = reviewServiceCard.getByRole("listitem").filter({ hasText: requirement!.name_en });
  await reviewRequirementRow.getByRole("button", { name: /^review$/i }).click();
  const [reviewResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rest/v1/provider_requirement_fulfillments") && response.request().method() === "PATCH"),
    reviewRequirementRow.getByRole("button", { name: /^passed$/i }).click(),
  ]);
  expect(reviewResponse.ok(), `requirement review should succeed: ${reviewResponse.status()} ${await reviewResponse.text().catch(() => "")}`).toBe(true);
  const { data: reviewedFulfillment } = await supabaseAdmin.from("provider_requirement_fulfillments").select("status,reviewed_by").eq("id", fulfillment!.id).single();
  expect(reviewedFulfillment!.status).toBe("passed");
  expect(reviewedFulfillment!.reviewed_by).toBeTruthy();
  await page.goto(`/admin/provider/${provider!.id}`);
  serviceRow = page.getByRole("listitem").filter({ hasText: service!.name_en });
  const [approveServiceResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rpc/admin_set_provider_service_status") && response.request().method() === "POST"),
    serviceRow.getByRole("button", { name: /^approve$/i }).click(),
  ]);
  expect(approveServiceResponse.ok(), `provider-service approval should succeed: ${approveServiceResponse.status()} ${await approveServiceResponse.text().catch(() => "")}`).toBe(true);
  await page.reload();
  let storedService = await supabaseAdmin.from("provider_services").select("status,rejection_reason").eq("id", providerService!.id).single();
  expect(storedService.data).toMatchObject({ status: "approved", rejection_reason: null });

  await page.getByRole("button", { name: /suspend provider/i }).click();
  const [suspendResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rest/v1/providers") && response.request().method() === "PATCH"),
    page.getByRole("dialog").getByRole("button", { name: /confirm suspend/i }).click(),
  ]);
  expect(suspendResponse.ok(), `provider suspension should succeed: ${suspendResponse.status()} ${await suspendResponse.text().catch(() => "")}`).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /unsuspend provider/i }).click();
  const [unsuspendResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rest/v1/providers") && response.request().method() === "PATCH"),
    page.getByRole("dialog").getByRole("button", { name: /unsuspend provider/i }).click(),
  ]);
  expect(unsuspendResponse.ok(), `provider unsuspension should succeed: ${unsuspendResponse.status()} ${await unsuspendResponse.text().catch(() => "")}`).toBe(true);
  await page.reload();
  storedProvider = await supabaseAdmin.from("providers").select("is_verified,is_active").eq("id", provider!.id).single();
  expect(storedProvider.data).toMatchObject({ is_verified: true, is_active: true });

  await page.waitForLoadState("networkidle");
  const errors = readErrors();
  expect(errors.console).toEqual([]);
  expect(errors.network.filter((entry) => !entry.includes("favicon"))).toEqual([]);
  const { count: providerAudits } = await supabaseAdmin.from("audit_logs").select("id", { head: true, count: "exact" }).eq("entity", "providers").eq("entity_id", provider!.id);
  const { count: rejectedServiceAudits } = await supabaseAdmin.from("audit_logs").select("id", { head: true, count: "exact" }).eq("entity", "provider_services").eq("entity_id", rejectedProviderServiceId);
  const { count: approvedServiceAudits } = await supabaseAdmin.from("audit_logs").select("id", { head: true, count: "exact" }).eq("entity", "provider_services").eq("entity_id", providerService!.id);
  expect(providerAudits).toBeGreaterThanOrEqual(4);
  expect(rejectedServiceAudits).toBeGreaterThanOrEqual(2);
  expect(approvedServiceAudits).toBeGreaterThanOrEqual(2);

  await supabaseAdmin.from("provider_requirement_fulfillments").delete().eq("id", fulfillment!.id);
  await supabaseAdmin.from("service_requirements").delete().eq("id", requirement!.id);
  await supabaseAdmin.from("provider_services").delete().eq("id", providerService!.id);
  await supabaseAdmin.from("services").delete().eq("id", service!.id);
  await supabaseAdmin.from("providers").update(originalProviderState).eq("id", provider!.id);
});
