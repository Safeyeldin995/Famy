import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ARABIC_TITLE = "كشف حساب مقدم الخدمة";

test.describe("admin statement print PDF", () => {
  test.use({ locale: "ar-EG" });

  test("preview print route renders Arabic and page.pdf() is non-empty", async ({ page }) => {
    await page.goto("/preview/admin/providers");
    const providerLink = page.locator('a[href*="/preview/admin/provider/"]').first();
    await providerLink.waitFor({ timeout: 20_000 });
    const href = await providerLink.getAttribute("href");
    expect(href).toBeTruthy();
    const match = href!.match(/\/preview\/admin\/provider\/([^/?#]+)/);
    expect(match?.[1]).toBeTruthy();
    const providerId = match![1]!;
    const from = encodeURIComponent("2020-01-01T00:00:00.000Z");
    const to = encodeURIComponent("2035-01-01T00:00:00.000Z");
    await page.goto(`/preview/admin/provider/${providerId}/statement/print?from=${from}&to=${to}`);
    await page.getByRole("heading", { name: ARABIC_TITLE }).waitFor({ timeout: 20_000 });
    const bodyText = await page.locator(".statement-print").innerText();
    expect(bodyText).toMatch(/[\u0600-\u06FF]/);
    expect(bodyText).toContain("الرصيد");

    const outDir = path.join(process.cwd(), "qa-artifacts", "admin-daily-ops-ar");
    fs.mkdirSync(outDir, { recursive: true });
    const pdfPath = path.join(outDir, "statement-print-ar.pdf");
    const pdf = await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
    expect(pdf.byteLength).toBeGreaterThan(500);
  });
});