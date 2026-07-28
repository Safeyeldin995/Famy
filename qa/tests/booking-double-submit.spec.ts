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

const IDEMPOTENCY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test.describe("booking double submit", () => {
  test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/customer.json") });

  test("rapid repeated pay submission creates one booking and reuses idempotency key", async ({ page }) => {
    test.slow();
    test.setTimeout(120_000);
    const suffix = Date.now();
    const fixture = await createEligibleMarketplaceFixture(suffix);
    const rpcCapture = captureCreateBookingRpc(page);
    let bookingId: string | undefined;
    const bookingsBefore = await countCustomerProviderBookings(fixture.provider.id);
    let releaseHeldRpc: (() => void) | null = null;
    let holdingFirstRpc = false;
    let firstRpcHeld: (() => void) | null = null;
    const firstRpcHeldPromise = new Promise<void>((resolve) => {
      firstRpcHeld = resolve;
    });

    try {
      await page.route("**/rpc/create_booking", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        if (!holdingFirstRpc) {
          holdingFirstRpc = true;
          firstRpcHeld?.();
          await new Promise<void>((resolve) => {
            releaseHeldRpc = resolve;
          });
        }
        const response = await route.fetch();
        await route.fulfill({ response });
      });

      await walkToPaymentStep(page, fixture);
      const payButton = paySubmitButton(page);
      const errors = captureErrors(page);

      const navigationPromise = page.waitForURL(/\/booking\/[0-9a-f-]{36}/, { timeout: 60_000 });

      await payButton.click();
      await firstRpcHeldPromise;
      await expect(payButton).toBeDisabled({ timeout: 5_000 });
      await expect(payButton.locator(".animate-spin")).toBeVisible();
      await payButton.click({ force: true }).catch(() => undefined);

      releaseHeldRpc?.();

      await navigationPromise;
      await expect(page.getByText(/^Booking created$/)).toHaveCount(1);

      expect(rpcCapture.requests.length).toBeGreaterThanOrEqual(1);
      expect(rpcCapture.requests.length).toBeLessThanOrEqual(2);
      const idempotencyKey = rpcCapture.requests[0]?.idempotencyKey ?? "";
      expect(idempotencyKey).toMatch(IDEMPOTENCY_KEY_RE);
      if (rpcCapture.requests.length === 2) {
        expect(rpcCapture.requests[1]?.idempotencyKey).toBe(idempotencyKey);
      }

      const bookingPath = page.url().match(/\/booking\/([0-9a-f-]{36})/);
      bookingId = bookingPath?.[1];
      expect(bookingId).toBeTruthy();
      expect(await countCustomerProviderBookings(fixture.provider.id)).toBe(bookingsBefore + 1);
      expect(errors.readErrors()).toEqual({ console: [], network: [] });
    } finally {
      await page.unroute("**/rpc/create_booking");
      await cleanupEligibleMarketplaceFixture(fixture, bookingId);
    }
  });
});
