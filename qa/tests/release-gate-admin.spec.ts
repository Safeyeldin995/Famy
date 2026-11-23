import { expect, test } from "@playwright/test";
import path from "path";
import { captureErrors } from "./helpers";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

const RELEASE_GATE_SCREENS: Array<{ path: string; heading: RegExp }> = [
  { path: "/admin/reports", heading: /report/i },
  { path: "/admin/payments", heading: /payment/i },
  { path: "/admin/monitoring", heading: /monitoring/i },
  { path: "/admin/settings", heading: /settings/i },
];

for (const screen of RELEASE_GATE_SCREENS) {
  test(`release gate admin: ${screen.path}`, async ({ page }) => {
    const { readErrors } = captureErrors(page);
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.heading }).first()).toBeVisible({
      timeout: 20_000,
    });
    const errors = readErrors();
    expect(errors.network.filter((e) => !e.includes("favicon"))).toEqual([]);
    expect(errors.console).toEqual([]);
  });
}

test("release gate: provider statement print preview", async ({ page }) => {
  const { readErrors } = captureErrors(page);
  await page.goto("/admin/providers");
  await expect(page.getByRole("heading", { name: /providers/i })).toBeVisible({ timeout: 20_000 });
  const firstProvider = page.getByRole("link").filter({ hasText: /.+/ }).first();
  await firstProvider.click();
  await page.getByRole("link", { name: /statement|financial/i }).first().click({ timeout: 15_000 });
  await expect(page.getByText(/ledger|statement|balance/i).first()).toBeVisible({ timeout: 20_000 });
  expect(readErrors().console).toEqual([]);
});