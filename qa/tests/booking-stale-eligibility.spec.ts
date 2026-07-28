import { expect, test } from "@playwright/test";
import path from "path";
import { captureErrors } from "./helpers";
import {
  captureCreateBookingRpc,
  countCustomerProviderBookings,
  paySubmitButton,
  walkToPaymentStep,
} from "./booking-flow-helpers";
import { cleanupEligibleMarketplaceFixture, createEligibleMarketplaceFixture } from "./marketplace-fixtures.mjs";

test.describe("booking stale eligibility", () => {
  test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/customer.json") });

  test("canonical create_booking surfaces PROVIDER_INELIGIBLE after provider suspension", async ({ page, browser }) => {
    test.slow();
    test.setTimeout(180_000);
    const suffix = Date.now();
    const fixture = await createEligibleMarketplaceFixture(suffix);
    const adminContext = await browser.newContext({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });
    const adminPage = await adminContext.newPage();
    // Expected rejection from canonical create_booking when provider is suspended.
    const errors = captureErrors(page, {
      allowHttpErrors: [{ status: 400, url: /\/rpc\/create_booking/, method: "POST" }],
    });
    const rpcCapture = captureCreateBookingRpc(page);
    const bookingsBefore = await countCustomerProviderBookings(fixture.provider.id);

    try {
      await walkToPaymentStep(page, fixture);

      await adminPage.goto(`/admin/provider/${fixture.provider.id}`);
      const [suspendResponse] = await Promise.all([
        adminPage.waitForResponse((response) => response.url().includes("/rest/v1/providers") && response.request().method() === "PATCH"),
        adminPage.getByRole("button", { name: /suspend provider/i }).click(),
        adminPage.getByRole("dialog").getByRole("button", { name: /confirm suspend/i }).click(),
      ]);
      expect(suspendResponse.ok(), await suspendResponse.text()).toBe(true);

      const payButton = paySubmitButton(page);
      const [bookingResponse] = await Promise.all([
        page.waitForResponse((response) => response.url().includes("/rpc/create_booking") && response.request().method() === "POST"),
        payButton.click(),
      ]);
      expect(bookingResponse.ok()).toBe(false);
      await expect(page.getByText(/not available for booking right now/i)).toBeVisible({ timeout: 20_000 });
      expect(await countCustomerProviderBookings(fixture.provider.id)).toBe(bookingsBefore);
      expect(rpcCapture.responses).toHaveLength(1);
      expect(rpcCapture.responses[0]?.ok).toBe(false);
      expect(errors.readErrors()).toEqual({ console: [], network: [] });
    } finally {
      await adminContext.close();
      await cleanupEligibleMarketplaceFixture(fixture);
    }
  });
});
