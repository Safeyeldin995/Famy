import { test, expect } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";
import { captureErrors } from "./helpers";

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
  await expect(page.getByRole("listitem").filter({ hasText: slug })).toBeVisible({ timeout: 10_000 });

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

  const row = page.getByRole("listitem").filter({ hasText: titleEn });
  const [cancelResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rpc/admin_cancel_campaign") && response.request().method() === "POST"),
    row.getByRole("button", { name: /^cancel$/i }).click(),
  ]);
  expect(cancelResponse.ok(), `campaign cancellation should succeed: ${cancelResponse.status()} ${await cancelResponse.text().catch(() => "")}`).toBe(true);
  await page.reload();
  const { data: cancelled } = await supabaseAdmin.from("notification_campaigns").select("status").eq("id", created.id).single();
  expect(cancelled!.status).toBe("cancelled");

  const admin = readRegistry().users.find((user: any) => user.key === "adminSeed");
  const scheduledTitle = `QA_ scheduled campaign ${Date.now()}`;
  const { data: scheduled } = await supabaseAdmin.from("notification_campaigns").insert({
    title_en: scheduledTitle,
    title_ar: "QA scheduled ar",
    body_en: "QA_ scheduled body",
    body_ar: "QA scheduled body ar",
    target: "customers",
    channel_push: false,
    scheduled_for: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    status: "draft",
    created_by: admin.userId,
  }).select().single();
  await page.reload();
  const scheduledRow = page.getByRole("listitem").filter({ hasText: scheduledTitle });
  const [activateResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rpc/admin_activate_campaign") && response.request().method() === "POST"),
    scheduledRow.getByRole("button", { name: /^activate$/i }).click(),
  ]);
  expect(activateResponse.ok(), `campaign activation should succeed: ${activateResponse.status()} ${await activateResponse.text().catch(() => "")}`).toBe(true);
  await expect(scheduledRow).toContainText(/scheduled/i);
  const [scheduledCancelResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rpc/admin_cancel_campaign") && response.request().method() === "POST"),
    scheduledRow.getByRole("button", { name: /^cancel$/i }).click(),
  ]);
  expect(scheduledCancelResponse.ok(), `scheduled campaign cancellation should succeed: ${scheduledCancelResponse.status()} ${await scheduledCancelResponse.text().catch(() => "")}`).toBe(true);
  await page.reload();
  const { data: scheduledStored } = await supabaseAdmin.from("notification_campaigns").select("status").eq("id", scheduled!.id).single();
  expect(scheduledStored!.status).toBe("cancelled");

  await supabaseAdmin.from("notification_campaigns").delete().eq("id", created.id);
  await supabaseAdmin.from("notification_campaigns").delete().eq("id", scheduled!.id);
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

test("category, service area, reminder, and content settings persist", async ({ page }) => {
  test.slow();
  const { readErrors } = captureErrors(page);
  const { data: category } = await supabaseAdmin.from("categories").select("*").order("sort_order").limit(1).single();
  const { data: areasRow } = await supabaseAdmin.from("settings").select("value").eq("key", "service_areas").maybeSingle();
  const originalAreas = (areasRow?.value as any)?.areas ?? [
    { name: "Sheikh Zayed", enabled: true },
    { name: "6th of October", enabled: true },
  ];
  const { data: termsRow } = await supabaseAdmin.from("settings").select("value").eq("key", "content_terms").maybeSingle();
  const originalTerms = termsRow?.value ?? { body_en: "", body_ar: "" };
  const leadMinutes = 10_000 + Math.floor(Math.random() * 10_000);
  let reminderId: string | undefined;

  try {
    await page.goto("/admin/settings");
    const categoriesSection = page.locator("section").filter({ has: page.getByRole("heading", { name: /categories/i }) });
    const categoryRow = categoriesSection.getByRole("listitem").filter({ hasText: category!.slug });
    await categoryRow.getByRole("button", { name: /^edit$/i }).click();
    const editingCategoryRow = categoriesSection.getByRole("listitem").filter({
      has: page.getByPlaceholder(/^english name$/i),
    }).first();
    await editingCategoryRow.getByPlaceholder(/^english name$/i).fill(`${category!.name_en} QA_`);
    const [categorySaveResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/rest/v1/categories") && response.request().method() === "PATCH"),
      editingCategoryRow.getByRole("button", { name: /^save$/i }).click(),
    ]);
    expect(categorySaveResponse.ok(), `category edit should succeed: ${categorySaveResponse.status()} ${await categorySaveResponse.text().catch(() => "")}`).toBe(true);
    const savedCategoryRow = categoriesSection.getByRole("listitem").filter({ hasText: category!.slug });
    await expect(savedCategoryRow).toContainText(`${category!.name_en} QA_`);
    const toggleCategory = savedCategoryRow.getByRole("button", { name: category!.is_active ? /^disable$/i : /^enable$/i });
    const [categoryToggleResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/rest/v1/categories") && response.request().method() === "PATCH"),
      toggleCategory.click(),
    ]);
    expect(categoryToggleResponse.ok(), `category toggle should succeed: ${categoryToggleResponse.status()} ${await categoryToggleResponse.text().catch(() => "")}`).toBe(true);
    await page.reload();
    const { data: storedCategory } = await supabaseAdmin.from("categories").select("name_en,is_active").eq("id", category!.id).single();
    expect(storedCategory).toMatchObject({ name_en: `${category!.name_en} QA_`, is_active: !category!.is_active });

    const serviceAreasSection = page.locator("section").filter({ has: page.getByRole("heading", { name: /service areas/i }) });
    const firstArea = originalAreas[0];
    const areaRow = serviceAreasSection.getByRole("listitem").filter({ hasText: firstArea.name });
    const [areaResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/rest/v1/settings?on_conflict=key") && response.request().method() === "POST"),
      areaRow.getByRole("button", { name: firstArea.enabled ? /^disable$/i : /^enable$/i }).click(),
    ]);
    expect(areaResponse.ok(), `service area toggle should succeed: ${areaResponse.status()} ${await areaResponse.text().catch(() => "")}`).toBe(true);
    await page.reload();
    const { data: storedAreas } = await supabaseAdmin.from("settings").select("value").eq("key", "service_areas").single();
    expect(((storedAreas!.value as any).areas as any[]).find((area) => area.name === firstArea.name).enabled).toBe(!firstArea.enabled);

    const remindersSection = page.locator("section").filter({ has: page.getByRole("heading", { name: /booking reminders/i }) });
    await remindersSection.getByPlaceholder(/minutes before start/i).fill(String(leadMinutes));
    const [reminderCreateResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/rest/v1/booking_reminder_rules") && response.request().method() === "POST"),
      remindersSection.getByRole("button", { name: /add rule/i }).click(),
    ]);
    expect(reminderCreateResponse.ok(), `reminder create should succeed: ${reminderCreateResponse.status()} ${await reminderCreateResponse.text().catch(() => "")}`).toBe(true);
    const { data: reminder } = await supabaseAdmin.from("booking_reminder_rules").select("*").eq("lead_minutes", leadMinutes).single();
    reminderId = reminder!.id;
    const reminderRow = remindersSection.getByRole("listitem").filter({ hasText: String(leadMinutes) });
    const [reminderToggleResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/rest/v1/booking_reminder_rules") && response.request().method() === "PATCH"),
      reminderRow.getByRole("button", { name: /^disable$/i }).click(),
    ]);
    expect(reminderToggleResponse.ok(), `reminder toggle should succeed: ${reminderToggleResponse.status()} ${await reminderToggleResponse.text().catch(() => "")}`).toBe(true);
    await page.reload();
    const { data: storedReminder } = await supabaseAdmin.from("booking_reminder_rules").select("is_active").eq("id", reminderId).single();
    expect(storedReminder!.is_active).toBe(false);

    const contentSection = page.locator("section").filter({ has: page.getByRole("heading", { name: /platform content/i }) });
    const termsCard = contentSection.locator("div.rounded-xl").filter({ hasText: /^terms/i }).first();
    const termsText = `QA_ terms ${Date.now()}`;
    await termsCard.locator("textarea").first().fill(termsText);
    const [termsResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/rest/v1/settings?on_conflict=key") && response.request().method() === "POST"),
      termsCard.getByRole("button", { name: /^save$/i }).click(),
    ]);
    expect(termsResponse.ok(), `terms save should succeed: ${termsResponse.status()} ${await termsResponse.text().catch(() => "")}`).toBe(true);
    await page.reload();
    const { data: storedTerms } = await supabaseAdmin.from("settings").select("value").eq("key", "content_terms").single();
    expect((storedTerms!.value as any).body_en).toBe(termsText);

    const errors = readErrors();
    expect(errors.console).toEqual([]);
    expect(errors.network.filter((entry) => !entry.includes("favicon"))).toEqual([]);
  } finally {
    await supabaseAdmin.from("categories").update({ name_en: category!.name_en, name_ar: category!.name_ar, is_active: category!.is_active }).eq("id", category!.id);
    await supabaseAdmin.from("settings").upsert({ key: "service_areas", value: { areas: originalAreas } }, { onConflict: "key" });
    await supabaseAdmin.from("settings").upsert({ key: "content_terms", value: originalTerms }, { onConflict: "key" });
    if (reminderId) await supabaseAdmin.from("booking_reminder_rules").delete().eq("id", reminderId);
  }
});
