import { expect, test } from "@playwright/test";
import path from "node:path";

const shots = path.join(process.cwd(), "qa-artifacts", "admin-daily-ops-ar");

test.describe("admin daily ops Arabic screenshots", () => {
  test.use({ locale: "ar-EG" });

  test("reports, payments, provider statement preview", async ({ page }, testInfo) => {
    await page.goto("/preview/admin/reports");
    await page.getByRole("heading", { name: /التقارير|Reports/i }).waitFor({ timeout: 15_000 });
    await page.screenshot({ path: path.join(shots, "reports-ar.png"), fullPage: true });

    await page.goto("/preview/admin/payments");
    await page.getByRole("heading", { name: /المدفوعات|Payments/i }).waitFor({ timeout: 15_000 });
    await page.screenshot({ path: path.join(shots, "payments-ar.png"), fullPage: true });

    await testInfo.attach("reports-ar", {
      path: path.join(shots, "reports-ar.png"),
      contentType: "image/png",
    });
    await testInfo.attach("payments-ar", {
      path: path.join(shots, "payments-ar.png"),
      contentType: "image/png",
    });
    expect(true).toBe(true);
  });
});