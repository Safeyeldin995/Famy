import { test, expect } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";
import { captureErrors } from "./helpers";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

function assertNoRuntimeErrors(readErrors: ReturnType<typeof captureErrors>["readErrors"]) {
  const errors = readErrors();
  expect(errors.console).toEqual([]);
  expect(errors.network.filter((e) => !e.includes("favicon"))).toEqual([]);
}

test("requirement evidence review persists and is audited once", async ({ page }) => {
  const { readErrors } = captureErrors(page);
  const reg = readRegistry();
  const providerUser = reg.users.find((u: any) => u.key === "provider");
  const { data: provider } = await supabaseAdmin.from("providers").select("id").eq("profile_id", providerUser.userId).single();
  const { data: service } = await supabaseAdmin.from("services").select("id,name_en").eq("is_active", true).limit(1).single();
  const { data: staleRequirements } = await supabaseAdmin.from("service_requirements").select("id").ilike("name_en", "QA_ evidence review%");
  for (const stale of staleRequirements ?? []) {
    await supabaseAdmin.from("provider_requirement_fulfillments").delete().eq("requirement_id", stale.id);
    await supabaseAdmin.from("service_requirements").delete().eq("id", stale.id);
  }
  const code = `qa_req_${Date.now()}`;
  const { data: requirement } = await supabaseAdmin.from("service_requirements").insert({
    service_id: service!.id, code, name_en: "QA_ evidence review", name_ar: "QA_ مراجعة دليل",
    requirement_type: "certification", required_for_provider_approval: true, required_during_booking: false,
    fulfillment_mode: "provider", provider_extra_fee: 0, evidence_required: false, is_active: true, sort_order: 999,
  }).select().single();
  expect(requirement, "requirement fixture should be created").toBeTruthy();
  const { data: fulfillment } = await supabaseAdmin.from("provider_requirement_fulfillments").insert({
    provider_id: provider!.id, requirement_id: requirement!.id, status: "pending", notes: "QA_ pending evidence",
  }).select().single();

  await page.goto("/admin/services");
  const serviceCard = page.getByRole("listitem").filter({ hasText: service!.name_en }).first();
  const requirementRow = serviceCard.getByRole("listitem").filter({ hasText: "QA_ evidence review" });
  await requirementRow.getByRole("button", { name: /^review$/i }).click();
  const passButton = requirementRow.getByRole("button", { name: "passed", exact: true });
  await expect(passButton).toBeVisible();
  const [reviewResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/rest/v1/provider_requirement_fulfillments") && r.request().method() === "PATCH"),
    passButton.click(),
  ]);
  expect(reviewResponse.ok(), await reviewResponse.text()).toBe(true);
  await expect(passButton).toBeDisabled();
  await page.reload();
  const { data: stored } = await supabaseAdmin.from("provider_requirement_fulfillments").select("status,reviewed_by").eq("id", fulfillment!.id).single();
  expect(stored!.status).toBe("passed");
  expect(stored!.reviewed_by).toBeTruthy();
  const { count } = await supabaseAdmin.from("audit_logs").select("id", { head: true, count: "exact" }).eq("entity", "provider_requirement_fulfillments").eq("entity_id", fulfillment!.id).eq("action", "UPDATE");
  expect(count).toBe(1);
  assertNoRuntimeErrors(readErrors);
  await supabaseAdmin.from("provider_requirement_fulfillments").delete().eq("id", fulfillment!.id);
  await supabaseAdmin.from("service_requirements").delete().eq("id", requirement!.id);
});

test("cancellation reason create edit deactivate activate persists", async ({ page }) => {
  const { readErrors } = captureErrors(page);
  const code = `qa_reason_${Date.now()}`;
  await page.goto("/admin/cancellation-reasons");
  await page.getByRole("button", { name: /new reason/i }).click();
  await page.getByLabel(/^code$/i).fill(code);
  await page.getByLabel(/^english name$/i).fill("QA_ cancellation reason");
  await page.getByLabel(/^arabic name$/i).fill("QA_ سبب إلغاء");
  const create = page.getByRole("button", { name: /create reason/i });
  await create.click();
  await expect(page.getByText("QA_ cancellation reason")).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: code });
  await row.getByRole("button", { name: /^edit$/i }).click();
  const editRow = page.locator(`input[value="${code}"]`).locator("xpath=ancestor::li[1]");
  await editRow.getByLabel(/^english name$/i).fill("QA_ cancellation reason edited");
  const [editResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/rest/v1/cancellation_reasons") && r.request().method() === "PATCH"),
    editRow.getByRole("button", { name: /^save$/i }).click(),
  ]);
  expect(editResponse.ok(), await editResponse.text()).toBe(true);
  await page.reload();
  const editedRow = page.getByRole("listitem").filter({ hasText: code });
  await expect(editedRow).toContainText("QA_ cancellation reason edited");
  await editedRow.getByRole("button", { name: /^deactivate$/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^deactivate$/i }).click();
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: code })).toContainText(/inactive/i);
  await page.getByRole("listitem").filter({ hasText: code }).getByRole("button", { name: /^activate$/i }).click();
  const { data: stored } = await supabaseAdmin.from("cancellation_reasons").select("*").eq("code", code).single();
  expect(stored).toMatchObject({ name_en: "QA_ cancellation reason edited", is_active: true });
  const { count: auditCount } = await supabaseAdmin.from("audit_logs").select("id", { head: true, count: "exact" }).eq("entity", "cancellation_reasons").eq("entity_id", stored!.id);
  expect(auditCount).toBe(4);
  assertNoRuntimeErrors(readErrors);
  await supabaseAdmin.from("cancellation_reasons").delete().eq("id", stored!.id);
});

test("case assignment persists through Admin UI", async ({ page }) => {
  const { readErrors } = captureErrors(page);
  const reg = readRegistry();
  const admin = reg.users.find((u: any) => u.key === "adminSeed");
  await supabaseAdmin.from("support_tickets").delete().ilike("subject", "QA_ assignment%");
  const { data: booking } = await supabaseAdmin.from("bookings").select("id,customer_id").eq("status", "cancelled").ilike("notes", "QA_%").limit(1).single();
  const subject = `QA_ assignment ${Date.now()}`;
  const { data: ticket, error: ticketError } = await supabaseAdmin.from("support_tickets").insert({
    booking_id: booking!.id, user_id: booking!.customer_id, opened_by_role: "customer", category: "other",
    subject, description: "QA_ assignment fixture", status: "open",
  }).select().single();
  expect(ticketError).toBeNull();
  await page.goto("/admin/cases");
  const row = page.getByRole("listitem").filter({ hasText: subject });
  await row.getByRole("button", { name: /view details/i }).click();
  const assign = row.getByRole("button", { name: /assign to me/i });
  await assign.click();
  await expect(row.getByRole("button", { name: /^assigned$/i })).toBeDisabled();
  await page.reload();
  const { data: stored } = await supabaseAdmin.from("support_tickets").select("assigned_admin_id").eq("id", ticket!.id).single();
  expect(stored!.assigned_admin_id).toBe(admin.userId);
  const { count: auditCount } = await supabaseAdmin.from("audit_logs").select("id", { head: true, count: "exact" }).eq("entity", "support_tickets").eq("entity_id", ticket!.id).eq("action", "UPDATE");
  expect(auditCount).toBe(1);
  assertNoRuntimeErrors(readErrors);
  await supabaseAdmin.from("support_tickets").delete().eq("id", ticket!.id);
});

test("case resolution requires notes and persists", async ({ page }) => {
  const { readErrors } = captureErrors(page);
  await supabaseAdmin.from("support_tickets").delete().ilike("subject", "QA_ resolution%");
  const { data: booking } = await supabaseAdmin.from("bookings").select("id,customer_id").eq("status", "cancelled").ilike("notes", "QA_%").limit(1).single();
  const subject = `QA_ resolution ${Date.now()}`;
  const { data: ticket, error: ticketError } = await supabaseAdmin.from("support_tickets").insert({
    booking_id: booking!.id, user_id: booking!.customer_id, opened_by_role: "customer", category: "app_issue",
    subject, description: "QA_ resolution fixture", status: "open",
  }).select().single();
  expect(ticketError).toBeNull();
  await page.goto("/admin/cases");
  const row = page.getByRole("listitem").filter({ hasText: subject });
  await row.getByRole("button", { name: /view details/i }).click();
  await row.locator("select").selectOption("resolved");
  const save = row.getByRole("button", { name: /^save$/i });
  await expect(save).toBeDisabled();
  const { data: stillOpen } = await supabaseAdmin.from("support_tickets").select("status").eq("id", ticket!.id).single();
  expect(stillOpen!.status).toBe("open");
  await row.getByLabel(/resolution notes/i).fill("QA_ resolved safely");
  const [saveResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/rest/v1/support_tickets") && r.request().method() === "PATCH"),
    save.click(),
  ]);
  expect(saveResponse.ok(), await saveResponse.text()).toBe(true);
  await expect(save).toBeEnabled();
  await page.reload();
  const { data: stored } = await supabaseAdmin.from("support_tickets").select("status,resolution_notes,resolved_at").eq("id", ticket!.id).single();
  expect(stored).toMatchObject({ status: "resolved", resolution_notes: "QA_ resolved safely" });
  expect(stored!.resolved_at).toBeTruthy();
  const { count: auditCount } = await supabaseAdmin.from("audit_logs").select("id", { head: true, count: "exact" }).eq("entity", "support_tickets").eq("entity_id", ticket!.id).eq("action", "UPDATE");
  expect(auditCount).toBe(1);
  const runtimeErrors = readErrors();
  expect(runtimeErrors.console.filter((e) => !e.includes("status of 400"))).toEqual([]);
  expect(runtimeErrors.network.filter((e) => !e.includes("support_tickets") || !e.startsWith("400 "))).toEqual([]);
  await supabaseAdmin.from("support_tickets").delete().eq("id", ticket!.id);
});

test("notification retry requeues once and is audited once", async ({ page }) => {
  const { readErrors } = captureErrors(page);
  const reg = readRegistry();
  const admin = reg.users.find((u: any) => u.key === "adminSeed");
  const { data: notification } = await supabaseAdmin.from("notifications").insert({
    user_id: admin.userId, title: "QA_ retry", type: "system", category: "system", channel: "in_app", payload: {},
  }).select().single();
  const { data: outbox } = await supabaseAdmin.from("notification_outbox").select("id").eq("notification_id", notification!.id).single();
  await supabaseAdmin.from("notification_outbox").update({ status: "dead", attempts: 5, last_error_safe: "QA_ safe failure" }).eq("id", outbox!.id);
  await page.goto("/admin/operations");
  const row = page.getByRole("listitem").filter({ hasText: "QA_ safe failure" });
  const retry = row.getByRole("button", { name: /^retry$/i });
  await expect(retry).toBeVisible({ timeout: 15_000 });
  let calls = 0;
  page.on("request", (r) => { if (r.url().includes("/rpc/admin_retry_notification")) calls++; });
  await retry.click();
  await expect(row).toHaveCount(0);
  await page.reload();
  const { data: stored } = await supabaseAdmin.from("notification_outbox").select("status,attempts,last_error_safe").eq("id", outbox!.id).single();
  expect(stored).toMatchObject({ status: "queued", attempts: 0, last_error_safe: null });
  expect(calls).toBe(1);
  const { count } = await supabaseAdmin.from("audit_logs").select("id", { head: true, count: "exact" }).eq("entity", "notification_outbox").eq("entity_id", outbox!.id).eq("action", "UPDATE");
  expect(count).toBe(2); // fixture transition to dead + the one Admin retry
  assertNoRuntimeErrors(readErrors);
  await supabaseAdmin.from("notifications").delete().eq("id", notification!.id);
});
