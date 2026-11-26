import { expect, test } from "@playwright/test";

/**
 * The /online header must fit phone widths: no horizontal page overflow, and
 * the nav collapses into a menu at the narrowest widths. The signed-in
 * notifications sheet is covered by OnlineWebNotificationsBell.sheet.test.tsx.
 */
const PAGES = ["/online", "/online/login", "/online/signup"];

for (const width of [360, 390, 430]) {
  test.describe(`online web header at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const path of PAGES) {
      test(`${path} has no horizontal overflow`, async ({ page }) => {
        await page.goto(path);
        await page.locator("header").first().waitFor();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        const header = await page.locator("header").first().boundingBox();
        expect(header?.width ?? 0).toBeLessThanOrEqual(width);
      });
    }

    if (width <= 400) {
      test("nav collapses into a menu button", async ({ page }) => {
        await page.goto("/online");
        const menu = page.getByRole("button", { expanded: false }).filter({ hasText: /القائمة|Menu/ });
        await expect(menu).toBeVisible();
        await menu.click();
        await expect(page.locator("#online-web-nav-menu")).toBeVisible();
      });
    }
  });
}
