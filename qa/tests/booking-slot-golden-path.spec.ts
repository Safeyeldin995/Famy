import { expect, test } from "@playwright/test";
import path from "path";
import { captureErrors } from "./helpers";
import {
  continueBooking,
  expectSlotsLoaded,
  fetchBookingSettings,
  pickFutureDate,
  selectFixtureService,
  walkToPaymentStep,
  paySubmitButton,
} from "./booking-flow-helpers";
import { cleanupEligibleMarketplaceFixture, createEligibleMarketplaceFixture } from "./marketplace-fixtures.mjs";

test.describe("booking slot golden path", () => {
  test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/customer.json") });

  test("Customer books an eligible Provider through the real slot picker UI", async ({ page }) => {
    test.slow();
    test.setTimeout(180_000);
    const suffix = Date.now();
    const fixture = await createEligibleMarketplaceFixture(suffix);
    let bookingId;

    try {
      await page.goto("/search");
      await page.getByLabel("Service").selectOption(fixture.service.id);
      await expect(page.locator(`a[href="/provider/${fixture.provider.id}"]`)).toBeVisible({ timeout: 30_000 });
      await page.locator(`a[href="/provider/${fixture.provider.id}"]`).click();
      await page.getByRole("button", { name: /book now|book/i }).click();
      await expect(page).toHaveURL(new RegExp(`/book/${fixture.provider.id}`));
      await page.goto(`/book/${fixture.provider.id}?serviceId=${fixture.service.id}`);

      const settings = await fetchBookingSettings(fixture);
      expect(settings.error).toBeFalsy();
      expect((settings.data ?? []).length).toBeGreaterThan(0);
      await continueBooking(page);
      await page.getByRole("button", { name: /2h/i }).first().click();
      await continueBooking(page);
      await pickFutureDate(page);
      await continueBooking(page);

      const slotButton = await expectSlotsLoaded(page);
      await slotButton.click();
      await continueBooking(page);
      await expect(page.getByText(/not currently served/i)).toHaveCount(0, { timeout: 15_000 });
      await continueBooking(page);
      await continueBooking(page);
      await continueBooking(page);
      await continueBooking(page);
      await page.getByRole("button", { name: /continue to payment/i }).click();
      await expect(paySubmitButton(page)).toBeVisible({ timeout: 20_000 });

      const errors = captureErrors(page);
      const [bookingResponse] = await Promise.all([
        page.waitForResponse((response) => response.url().includes("/rpc/create_booking") && response.request().method() === "POST"),
        paySubmitButton(page).click(),
      ]);
      expect(bookingResponse.ok(), await bookingResponse.text()).toBe(true);
      const payload = await bookingResponse.json();
      bookingId = payload?.booking_id;
      expect(bookingId).toBeTruthy();
      await expect(page).toHaveURL(new RegExp(`/booking/${bookingId}`), { timeout: 60_000 });
      expect(errors.readErrors()).toEqual({ console: [], network: [] });
    } finally {
      await cleanupEligibleMarketplaceFixture(fixture, bookingId);
    }
  });

  test("ineligible Provider cannot load booking slots and recovers after eligibility is restored", async ({ page, browser }) => {
    test.slow();
    test.setTimeout(180_000);
    const suffix = Date.now();
    const fixture = await createEligibleMarketplaceFixture(suffix);
    const adminContext = await browser.newContext({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });
    const adminPage = await adminContext.newPage();
    const customerErrors = captureErrors(page);

    try {
      const eligibleSettings = await fetchBookingSettings(fixture);
      expect(eligibleSettings.error).toBeFalsy();
      expect((eligibleSettings.data ?? []).length).toBeGreaterThan(0);

      await page.goto(`/book/${fixture.provider.id}`);
      await expect(page.getByText(/booking unavailable/i)).toHaveCount(0);
      await expect(page.getByText(/step 1 of/i)).toBeVisible({ timeout: 20_000 });
      await selectFixtureService(page, fixture);
      await continueBooking(page);
      await page.getByRole("button", { name: /2h/i }).first().click();
      await continueBooking(page);
      await pickFutureDate(page);
      await continueBooking(page);
      await expectSlotsLoaded(page);

      await adminPage.goto(`/admin/provider/${fixture.provider.id}`);
      const [suspendResponse] = await Promise.all([
        adminPage.waitForResponse((response) => response.url().includes("/rest/v1/providers") && response.request().method() === "PATCH"),
        adminPage.getByRole("button", { name: /suspend provider/i }).click(),
        adminPage.getByRole("dialog").getByRole("button", { name: /confirm suspend/i }).click(),
      ]);
      expect(suspendResponse.ok(), await suspendResponse.text()).toBe(true);

      const suspendedSettings = await fetchBookingSettings(fixture);
      expect(suspendedSettings.error).toBeFalsy();
      expect(suspendedSettings.data ?? []).toHaveLength(0);

      const [settingsResponse] = await Promise.all([
        page.waitForResponse((response) => response.url().includes("marketplace_provider_booking_settings")),
        page.goto(`/book/${fixture.provider.id}`),
      ]);
      expect(settingsResponse.ok()).toBe(true);
      expect(await settingsResponse.json()).toEqual([]);

      await expect(page.getByText(/booking unavailable/i)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/isn't accepting bookings/i)).toBeVisible();
      await expect(page.getByText(/step 1 of/i)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^continue$/i })).toHaveCount(0);
      await expect(page.locator("button").filter({ hasText: /:\d{2}/ })).toHaveCount(0);

      await adminPage.getByRole("button", { name: /unsuspend provider/i }).click();
      await adminPage.getByRole("dialog").getByRole("button", { name: /unsuspend provider/i }).click();

      const restoredSettings = await fetchBookingSettings(fixture);
      expect(restoredSettings.error).toBeFalsy();
      expect((restoredSettings.data ?? []).length).toBeGreaterThan(0);

      await page.goto(`/book/${fixture.provider.id}`);
      await expect(page.getByText(/booking unavailable/i)).toHaveCount(0, { timeout: 20_000 });
      await selectFixtureService(page, fixture);
      await continueBooking(page);
      await page.getByRole("button", { name: /2h/i }).first().click();
      await continueBooking(page);
      await pickFutureDate(page);
      await continueBooking(page);
      await expectSlotsLoaded(page);
      expect(customerErrors.readErrors()).toEqual({ console: [], network: [] });
    } finally {
      await adminContext.close();
      await cleanupEligibleMarketplaceFixture(fixture);
    }
  });
});
