import { expect, test, type Page } from "@playwright/test";
import path from "path";
import { captureErrors } from "./helpers";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

type ReleaseGateScreen = {
  path: string;
  heading: RegExp;
  waitForLoaded: (page: Page) => Promise<void>;
};

const RELEASE_GATE_SCREENS: ReleaseGateScreen[] = [
  {
    path: "/admin/reports",
    heading: /report/i,
    async waitForLoaded(page) {
      await expect(
        page.locator("table").or(page.getByRole("button", { name: /retry|إعادة/i })).first(),
      ).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    path: "/admin/payments",
    heading: /payment/i,
    async waitForLoaded(page) {
      await expect(
        page
          .locator("ul.grid")
          .or(
            page.getByText(
              /No payments match this search\/filter\.|لا توجد مدفوعات مطابقة/,
            ),
          )
          .or(page.getByRole("button", { name: /retry|إعادة/i }))
          .first(),
      ).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    path: "/admin/monitoring",
    heading: /monitoring/i,
    async waitForLoaded(page) {
      await expect(page.locator(".grid.grid-cols-1.gap-3 .animate-pulse")).toHaveCount(0, {
        timeout: 20_000,
      });
      await expect(
        page
          .locator("section")
          .filter({ has: page.locator("h3") })
          .locator("h3")
          .first()
          .or(page.getByRole("button", { name: /retry|إعادة/i })),
      ).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    path: "/admin/settings",
    heading: /settings/i,
    async waitForLoaded(page) {
      const billingSection = page.locator("details").filter({ has: page.locator("#billing-vatPercent") });
      const billingInput = page.locator("#billing-vatPercent");
      if ((await billingSection.count()) > 0 && !(await billingInput.isVisible())) {
        await billingSection.locator("summary").click();
      }
      await expect(
        billingInput.or(page.getByRole("button", { name: /retry|إعادة/i })),
      ).toBeVisible({ timeout: 20_000 });
    },
  },
];

for (const screen of RELEASE_GATE_SCREENS) {
  test(`release gate admin: ${screen.path}`, async ({ page }) => {
    const { readErrors } = captureErrors(page);
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.heading }).first()).toBeVisible({
      timeout: 20_000,
    });
    await screen.waitForLoaded(page);
    const errors = readErrors();
    expect(errors.network.filter((e) => !e.includes("favicon"))).toEqual([]);
    expect(errors.console).toEqual([]);
  });
}