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