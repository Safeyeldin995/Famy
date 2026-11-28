import { test, expect, db, openAs, seed, expectNoErrors } from "./fixtures";

/**
 * Provider credentials (PO, 28 Nov): the tutor adds education and a certificate
 * from «كمل ملفك», admin verifies the certificate, and the public tutor profile
 * shows the education and the verified certificate only.
 */

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.describe.serial("provider credentials", () => {
  test("the approved tutor sees «كمل ملفك» and adds education", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, "tutor");
    await page.goto("/pro");
    const card = page.getByRole("region", { name: "كمل ملفك" });
    await expect(card).toBeVisible();
    await card.getByRole("link", { name: /تعليمك/ }).click();
    await expect(page).toHaveURL(/\/pro\/setup\/education/);
    await expect(page.getByRole("heading", { name: "تعليمك" })).toBeVisible();

    await page.getByRole("button", { name: "ضيف تعليم" }).click();
    await page.getByLabel("الجامعة أو المعهد").fill("جامعة عين شمس");
    await page.getByLabel("الدرجة").fill("بكالوريوس");
    await page.getByLabel("التخصص (اختياري)").fill("رياضيات");
    await page.getByLabel("سنة البداية").fill("2010");
    await page.getByLabel("سنة النهاية").fill("2014");
    await page.getByRole("button", { name: "احفظ" }).click();
    await expect(page.getByText("بكالوريوس · رياضيات")).toBeVisible();
    expectNoErrors(errors);
    await context.close();
  });

  test("the tutor adds a certificate with a file; it waits for review", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, "tutor");
    await page.goto("/pro/setup/certificates");
    await page.getByRole("button", { name: "ضيف شهادة" }).click();
    await page.getByLabel("اسم الشهادة").fill("TEFL");
    await page.getByLabel("الجهة اللي أصدرتها").fill("British Council");
    await page.getByLabel("صورة الشهادة أو ملف PDF").setInputFiles({
      name: "tefl.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await page.getByRole("button", { name: "احفظ" }).click();
    await expect(page.getByText("بنراجعها")).toBeVisible();

    const { data } = await db
      .from("provider_certificates")
      .select("status, file_path")
      .eq("provider_id", seed.providerId);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe("pending");
    expect(String(data?.[0]?.file_path)).toMatch(new RegExp(`^${seed.providerId}/certificate/`));
    expectNoErrors(errors);
    await context.close();
  });

  test("a guest sees the education but not the unverified certificate", async ({ page }) => {
    await page.goto(`/online/tutors/${seed.providerId}`);
    await expect(page.getByRole("heading", { name: "التعليم" })).toBeVisible();
    await expect(page.getByText("جامعة عين شمس")).toBeVisible();
    await expect(page.getByText("TEFL")).toHaveCount(0);
  });

  test("admin verifies the certificate from the provider page", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, "admin");
    await page.goto("/admin/providers");
    await page.getByRole("link", { name: /TEFL/ }).click();
    const section = page.getByRole("region", { name: "التعليم والخبرة والشهادات" });
    await expect(section).toBeVisible();
    await section.getByRole("button", { name: "اتأكدنا منها" }).click();
    await expect(section.getByText("اتأكدنا منها").first()).toBeVisible();
    await expect
      .poll(async () => {
        const { data } = await db
          .from("provider_certificates")
          .select("status")
          .eq("provider_id", seed.providerId)
          .single();
        return data?.status;
      })
      .toBe("verified");
    expectNoErrors(errors);
    await context.close();
  });

  test("the public tutor profile shows the verified certificate badge", async ({ page }) => {
    await page.goto(`/online/tutors/${seed.providerId}`);
    await expect(page.getByRole("heading", { name: "الشهادات" })).toBeVisible();
    await expect(page.getByText("TEFL")).toBeVisible();
    await expect(page.getByText("شهادة متأكد منها")).toBeVisible();
  });
});
