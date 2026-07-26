import { test, expect } from "@playwright/test";
import path from "path";
import { resetRegistryProviderToDraft } from "./registry-fixtures.mjs";

test.describe("provider onboarding RTL", () => {
  test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/provider.json") });

  test("Arabic onboarding wizard renders RTL progress", async ({ page }) => {
    await resetRegistryProviderToDraft();
    await page.addInitScript(() => localStorage.setItem("famio.lang", "ar"));
    await page.goto("/pro/onboarding");
    await expect(page.locator("html[dir='rtl']")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /تسجيل مزود الخدمة/i })).toBeVisible();
    await expect(page.getByText(/البيانات الشخصية/i)).toBeVisible();
  });
});
