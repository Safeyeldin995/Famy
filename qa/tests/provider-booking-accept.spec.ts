import { expect, test } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { registerE2eRunResource } from "../registry.mjs";
import { captureErrors } from "./helpers";
import { paySubmitButton, walkToPaymentStep } from "./booking-flow-helpers";
import {
  cleanupEligibleMarketplaceFixture,
  createEligibleMarketplaceFixture,
} from "./marketplace-fixtures.mjs";

test.describe("provider booking accept golden path", () => {
  test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/customer.json") });

  test("assigned provider accepts a customer pending booking through the real UI", async ({
    page,
    browser,
  }) => {
    test.slow();
    test.setTimeout(300_000);
    const suffix = Date.now();
    const fixture = await createEligibleMarketplaceFixture(suffix);
    let bookingId: string | undefined;

    const providerContext = await browser.newContext({
      storageState: path.resolve(process.cwd(), "qa/.auth/provider.json"),
    });
    const providerPage = await providerContext.newPage();
    const customerErrors = captureErrors(page);
    const providerErrors = captureErrors(providerPage);

    try {
      await walkToPaymentStep(page, fixture);

      const [bookingResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/rpc/create_booking") &&
            response.request().method() === "POST",
        ),
        paySubmitButton(page).click(),
      ]);
      expect(bookingResponse.ok(), await bookingResponse.text()).toBe(true);
      const payload = await bookingResponse.json();
      bookingId = payload?.booking_id;
      expect(bookingId).toBeTruthy();
      registerE2eRunResource("bookingIds", bookingId!);
      await expect(page).toHaveURL(new RegExp(`/booking/${bookingId}`), { timeout: 60_000 });

      const { data: pendingBooking, error: pendingError } = await supabaseAdmin
        .from("bookings")
        .select("id, status, provider_id")
        .eq("id", bookingId!)
        .single();
      expect(pendingError).toBeFalsy();
      expect(pendingBooking).toMatchObject({
        id: bookingId,
        status: "pending",
        provider_id: fixture.provider.id,
      });

      await expect(page.getByText(/Chat becomes available after confirmation/i)).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByPlaceholder(/Message/i)).toHaveCount(0);

      await providerPage.goto("/pro/bookings");
      await expect(providerPage.getByRole("button", { name: /Requests \(\d+\)/i })).toBeVisible({
        timeout: 30_000,
      });
      const bookingLink = providerPage.locator(`a[href="/pro/booking/${bookingId}"]`);
      await expect(bookingLink).toBeVisible({ timeout: 30_000 });
      await expect(bookingLink).toContainText(fixture.serviceName);
      await bookingLink.click();
      await expect(providerPage).toHaveURL(new RegExp(`/pro/booking/${bookingId}`), {
        timeout: 20_000,
      });
      await expect(providerPage.getByRole("button", { name: /^accept$/i })).toBeVisible({
        timeout: 20_000,
      });

      const [statusResponse] = await Promise.all([
        providerPage.waitForResponse(
          (response) =>
            response.url().includes("/rest/v1/bookings") &&
            response.request().method() === "PATCH" &&
            response.ok() &&
            new URL(response.url()).searchParams.get("id") === `eq.${bookingId!}`,
        ),
        providerPage.getByRole("button", { name: /^accept$/i }).click(),
      ]);
      expect(statusResponse.ok(), await statusResponse.text()).toBe(true);

      const { data: confirmedBooking, error: confirmedError } = await supabaseAdmin
        .from("bookings")
        .select("id, status")
        .eq("id", bookingId!)
        .single();
      expect(confirmedError).toBeFalsy();
      expect(confirmedBooking?.status).toBe("confirmed");

      const { data: history, error: historyError } = await supabaseAdmin
        .from("booking_status_history")
        .select("from_status, to_status")
        .eq("booking_id", bookingId!)
        .order("created_at");
      expect(historyError).toBeFalsy();
      expect(history?.map((row) => row.to_status)).toEqual(["pending", "confirmed"]);
      expect(
        history?.find((row) => row.from_status === "pending" && row.to_status === "confirmed"),
      ).toBeTruthy();

      await expect(providerPage.getByText(/^Confirmed$/i)).toBeVisible({ timeout: 20_000 });

      await page.goto(`/booking/${bookingId}`);
      await expect(page.getByText(/Booking #.* is confirmed\./i)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByPlaceholder(/Message/i)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Chat becomes available after confirmation/i)).toHaveCount(0);

      expect(customerErrors.readErrors()).toEqual({ console: [], network: [] });
      expect(providerErrors.readErrors()).toEqual({ console: [], network: [] });
    } finally {
      try {
        await providerContext.close();
      } finally {
        await cleanupEligibleMarketplaceFixture(fixture, bookingId);
      }
    }
  });
});
