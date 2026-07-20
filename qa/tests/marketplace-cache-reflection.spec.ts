import { expect, test } from "@playwright/test";
import path from "path";
import { cleanupEligibleMarketplaceFixture, createEligibleMarketplaceFixture } from "./marketplace-fixtures.mjs";
import { captureErrors } from "./helpers";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/customer.json") });

test("Customer marketplace view reflects Admin eligibility changes without manual reload", async ({ page, browser }) => {
  test.slow();
  test.setTimeout(300_000);
  const suffix = Date.now();
  const fixture = await createEligibleMarketplaceFixture(suffix);
  const adminContext = await browser.newContext({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });
  const adminPage = await adminContext.newPage();
  const customerErrors = captureErrors(page);

  try {
    await page.goto("/search");
    await page.getByLabel("Service").selectOption(fixture.service.id);
    await page.waitForResponse(
      (response) => response.url().includes("search_marketplace_providers") && response.ok(),
      { timeout: 30_000 },
    );
    await expect(page.locator(`a[href="/provider/${fixture.provider.id}"]`)).toBeVisible({ timeout: 30_000 });

    await adminPage.goto(`/admin/provider/${fixture.provider.id}`);
    await adminPage.getByRole("button", { name: /suspend provider/i }).click();
    await adminPage.getByRole("dialog").getByRole("button", { name: /confirm suspend/i }).click();

    await expect(page.locator(`a[href="/provider/${fixture.provider.id}"]`)).toHaveCount(0, { timeout: 15_000 });

    await adminPage.getByRole("button", { name: /unsuspend provider/i }).click();
    await adminPage.getByRole("dialog").getByRole("button", { name: /unsuspend provider/i }).click();

    await expect(page.locator(`a[href="/provider/${fixture.provider.id}"]`)).toBeVisible({ timeout: 15_000 });
    expect(customerErrors.readErrors()).toEqual({ console: [], network: [] });
  } finally {
    await adminContext.close();
    await cleanupEligibleMarketplaceFixture(fixture);
  }
});
