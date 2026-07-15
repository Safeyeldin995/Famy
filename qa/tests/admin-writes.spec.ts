import { test, expect } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

test("create/edit a payment method and it persists after refresh", async ({ page }) => {
  const code = `qa_pm_${Date.now()}`;
  await page.goto("/admin/payment-methods");
  await page.getByRole("button", { name: /^new method$/i }).click();
  await page.getByLabel(/^code$/i).fill(code);
  await page.getByLabel(/^english name$/i).fill("QA_ payment method");
  await page.getByLabel(/^arabic name$/i).fill("QA_ طريقة دفع");
  await page.getByRole("button", { name: /^create method$/i }).click();
  await expect(page.getByRole("heading", { name: /new payment method/i })).toHaveCount(0, { timeout: 10_000 });

  const { data: created } = await supabaseAdmin.from("payment_methods").select("*").eq("code", code).single();
  expect(created.name_en).toBe("QA_ payment method");

  await page.reload();
  await expect(page.getByText("QA_ payment method")).toBeVisible({ timeout: 10_000 });

  // edit
  await page.getByText("QA_ payment method").locator("xpath=ancestor::li[1]").getByRole("button", { name: /^edit$/i }).click();
  await page.getByLabel(/^english name$/i).fill("QA_ payment method edited");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText("QA_ payment method edited")).toBeVisible({ timeout: 10_000 });

  const { data: after } = await supabaseAdmin.from("payment_methods").select("*").eq("code", code).single();
  expect(after.name_en).toBe("QA_ payment method edited");

  const { data: auditRow } = await supabaseAdmin.from("audit_logs").select("*").eq("entity", "payment_methods").eq("entity_id", created.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  expect(auditRow, "payment method write should be audited").toBeTruthy();

  await supabaseAdmin.from("payment_methods").delete().eq("id", created.id);
});

test("create/edit a service and it persists after refresh", async ({ page }) => {
  test.slow(); // the categories dropdown can be slow to populate — see admin-writes note
  const slug = `qa-service-${Date.now()}`;

  await page.goto("/admin/services");
  // "New service" is disabled until categories have loaded (fixed: it used
  // to pre-fill category_id from a click-time snapshot of the categories
  // list, which was silently empty — and stayed empty for that form session
  // — if clicked before the categories query resolved).
  const newServiceBtn = page.getByRole("button", { name: /^new service$/i });
  await expect(newServiceBtn).toBeEnabled({ timeout: 20_000 });
  await newServiceBtn.click();
  const form = page.locator("section", { has: page.getByRole("heading", { name: /^new service$/i }) });
  await form.getByLabel(/^english name$/i).fill("QA_ service");
  await form.getByLabel(/^arabic name$/i).fill("QA_ خدمة");
  await form.getByLabel(/^slug$/i).fill(slug);
  await form.getByLabel(/base price/i).fill("100");
  await form.getByLabel(/duration/i).fill("60");
  const [createResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/rest/v1/services") && r.request().method() === "POST"),
    form.getByRole("button", { name: /^create service$/i }).click(),
  ]);
  expect(createResponse.ok(), `service create should succeed: ${createResponse.status()} ${await createResponse.text().catch(() => "")}`).toBe(true);
  await expect(page.getByRole("heading", { name: /new service/i })).toHaveCount(0, { timeout: 10_000 });

  const { data: created } = await supabaseAdmin.from("services").select("*").eq("slug", slug).single();
  expect(created.name_en).toBe("QA_ service");
  expect(created.category_id, "category should have been pre-selected and submitted").toBeTruthy();

  await page.reload();
  await expect(page.getByText("QA_ service")).toBeVisible({ timeout: 10_000 });

  const { data: auditRow } = await supabaseAdmin.from("audit_logs").select("*").eq("entity", "services").eq("entity_id", created.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  expect(auditRow, "service write should be audited").toBeTruthy();

  await supabaseAdmin.from("services").delete().eq("id", created.id);
});

test("create a promo code and it validates", async ({ page }) => {
  const code = `QA_PROMO_${Date.now()}`;
  await page.goto("/admin/promo-codes");
  await page.getByRole("button", { name: /^new promo code$/i }).click();
  await page.getByLabel(/^code$/i).fill(code);
  await page.getByLabel(/discount \(egp\)|discount value|fixed amount/i).first().fill("10");
  await page.getByRole("button", { name: /^create promo code$/i }).click();
  await expect(page.getByRole("heading", { name: /new promo code/i })).toHaveCount(0, { timeout: 10_000 });

  const { data: created } = await supabaseAdmin.from("promo_codes").select("*").eq("code", code).single();
  expect(created.discount_value).toBe(10);
  expect(created.is_active).toBe(true);

  await page.reload();
  await expect(page.getByText(code)).toBeVisible({ timeout: 10_000 });

  await supabaseAdmin.from("promo_codes").delete().eq("id", created.id);
});

test("create a campaign draft and it persists", async ({ page }) => {
  const titleEn = `QA_ campaign ${Date.now()}`;
  await page.goto("/admin/campaigns");
  await page.getByPlaceholder(/title \(english\)/i).fill(titleEn);
  await page.getByPlaceholder(/title.*عربي|العنوان/i).fill("QA_ حملة");
  await page.getByPlaceholder(/body \(english\)/i).fill("QA_ automated campaign body.");
  await page.getByPlaceholder(/body.*عربي|النص/i).fill("QA_ نص تلقائي.");
  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(page.getByText(titleEn)).toBeVisible({ timeout: 10_000 });

  const { data: created } = await supabaseAdmin.from("notification_campaigns").select("*").eq("title_en", titleEn).single();
  expect(created.status).toBe("draft");

  await supabaseAdmin.from("notification_campaigns").delete().eq("id", created.id);
});

test("settings VAT update persists after refresh", async ({ page }) => {
  // Known baseline (not "whatever the last run left") so this test doesn't
  // depend on prior run state.
  const { data: before } = await supabaseAdmin.from("settings").select("value").eq("key", "billing").maybeSingle();
  const originalValue = (before?.value as any) ?? { vat_percent: 14, platform_fee: 25 };
  await supabaseAdmin.from("settings").upsert({ key: "billing", value: { vat_percent: 14, platform_fee: 25 } }, { onConflict: "key" });
  const testValue = 19;

  await page.goto("/admin/settings");
  const vatInput = page.getByLabel(/vat/i);
  await expect(vatInput).toHaveValue("14", { timeout: 10_000 }); // confirms the baseline actually loaded before we edit
  await vatInput.fill(String(testValue));
  const [saveResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/rest/v1/settings?on_conflict=key") && r.request().method() === "POST"),
    page.getByRole("button", { name: /^save$/i }).first().click(),
  ]);
  expect(saveResponse.ok(), `settings save should succeed: ${saveResponse.status()} ${await saveResponse.text().catch(() => "")}`).toBe(true);
  await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByLabel(/vat/i)).toHaveValue(String(testValue), { timeout: 10_000 });

  const { data: after } = await supabaseAdmin.from("settings").select("value").eq("key", "billing").single();
  expect(Number((after!.value as any).vat_percent)).toBe(testValue);

  // restore original value so this test doesn't leave the DB changed
  await supabaseAdmin.from("settings").upsert({ key: "billing", value: originalValue }, { onConflict: "key" });
});
