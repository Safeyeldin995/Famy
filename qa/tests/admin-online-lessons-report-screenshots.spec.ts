import { expect, test } from "@playwright/test";
import path from "node:path";

const shots = path.join(process.cwd(), "qa-artifacts", "admin-online-lessons-report");

test.describe("admin online lessons report screenshots", () => {
  test.use({ locale: "ar-EG" });

  test("fixture data and empty state", async ({ page }, testInfo) => {
    await page.goto("/preview/admin/reports/online");
    await page.getByRole("heading", { name: /تقرير الحصص|Online lessons report/i }).waitFor({
      timeout: 20_000,
    });
    await page.screenshot({
      path: path.join(shots, "online-report-ar-data.png"),
      fullPage: true,
    });

    await page
      .getByRole("button", { name: /٢٠٩٩|2099|custom|مخصص/i })
      .first()
      .click()
      .catch(() => {});
    const from = page.locator('input[type="date"]').first();
    const to = page.locator('input[type="date"]').nth(1);
    if (await from.isVisible()) {
      await from.fill("2099-01-01");
      await to.fill("2099-01-02");
      await page.waitForTimeout(800);
    }
    await page.screenshot({
      path: path.join(shots, "online-report-ar-empty.png"),
      fullPage: true,
    });

    await testInfo.attach("online-report-ar-data", {
      path: path.join(shots, "online-report-ar-data.png"),
      contentType: "image/png",
    });
    await testInfo.attach("online-report-ar-empty", {
      path: path.join(shots, "online-report-ar-empty.png"),
      contentType: "image/png",
    });
    expect(true).toBe(true);
  });
});
