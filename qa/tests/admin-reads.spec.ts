import { test, expect } from "@playwright/test";
import path from "path";
import { captureErrors } from "./helpers";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

const SCREENS: Array<{ path: string; heading: RegExp }> = [
  { path: "/admin", heading: /overview|kpi|dashboard/i },
  { path: "/admin/operations", heading: /operations/i },
  { path: "/admin/providers", heading: /providers/i },
  { path: "/admin/customers", heading: /customers/i },
  { path: "/admin/bookings", heading: /bookings/i },
  { path: "/admin/cases", heading: /cases/i },
  { path: "/admin/cancellation-reasons", heading: /cancellation/i },
  { path: "/admin/payments", heading: /payments/i },
  { path: "/admin/payment-methods", heading: /payment method/i },
  { path: "/admin/services", heading: /services/i },
  { path: "/admin/promo-codes", heading: /promo/i },
  { path: "/admin/zones", heading: /zones/i },
  { path: "/admin/campaigns", heading: /campaigns/i },
  { path: "/admin/audit-log", heading: /audit/i },
  { path: "/admin/settings", heading: /settings/i },
];

for (const screen of SCREENS) {
  test(`admin read: ${screen.path} loads without console/network errors`, async ({ page }) => {
    const { readErrors } = captureErrors(page);
    await page.goto(screen.path);
    // Fails the whole app shows the "Admin access only" gate for a role we granted.
    await expect(page.getByText(/admin access only|admin-only|adminOnlyTitle/i)).toHaveCount(0);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const errors = readErrors();
    const realNetworkErrors = errors.network.filter((e) => !e.includes("favicon"));

    if (errors.console.length || realNetworkErrors.length) {
      console.log(`[${screen.path}] console errors:`, errors.console);
      console.log(`[${screen.path}] network errors:`, realNetworkErrors);
    }
    expect(realNetworkErrors, `network errors on ${screen.path}`).toEqual([]);
    expect(errors.console, `console errors on ${screen.path}`).toEqual([]);
  });
}
