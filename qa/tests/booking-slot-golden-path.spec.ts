import { expect, test } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { authenticatedClient } from "../authenticated-client.mjs";
import { readRegistry } from "../registry.mjs";
import { captureErrors } from "./helpers";
import { cleanupEligibleMarketplaceFixture, createEligibleMarketplaceFixture } from "./marketplace-fixtures.mjs";

async function selectFixtureService(page, fixture: { serviceName: string }) {
  await page.getByRole("button", { name: fixture.serviceName }).click();
}

async function continueBooking(page) {
  await page.getByRole("button", { name: /^continue$/i }).click();
}

async function pickFutureDate(page) {
  const dateButtons = page.locator("button").filter({ hasText: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i });
  await expect(dateButtons.first()).toBeVisible({ timeout: 20_000 });
  await dateButtons.nth(2).click();
}

async function expectSlotsLoaded(page) {
  await page.waitForResponse(
    (response) => response.url().includes("marketplace_provider_booking_settings") && response.ok(),
    { timeout: 30_000 },
  );
  await expect(page.getByText(/no times available/i)).toHaveCount(0, { timeout: 20_000 });
  const slotButton = page.locator("button").filter({ hasText: /:\d{2}/ }).first();
  await expect(slotButton).toBeVisible({ timeout: 20_000 });
  return slotButton;
}

async function fetchBookingSettings(fixture) {
  const registry = readRegistry();
  const customer = registry.users.find((u) => u.key === "customer");
  const { data: address, error: addressError } = await supabaseAdmin.from("addresses")
    .select("id")
    .eq("user_id", customer!.userId)
    .eq("is_default", true)
    .single();
  if (addressError) throw addressError;
  return authenticatedClient("customer").rpc("marketplace_provider_booking_settings", {
    p_provider_id: fixture.provider.id,
    p_service_id: fixture.service.id,
    p_address_id: address!.id,
  });
}

async function countCustomerProviderBookings(providerId: string) {
  const registry = readRegistry();
  const customer = registry.users.find((u) => u.key === "customer");
  const { count, error } = await supabaseAdmin.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customer!.userId)
    .eq("provider_id", providerId);
  if (error) throw error;
  return count ?? 0;
}

async function attemptDirectBooking(fixture) {
  const registry = readRegistry();
  const customer = registry.users.find((u) => u.key === "customer");
  const { data: address, error: addressError } = await supabaseAdmin.from("addresses")
    .select("id")
    .eq("user_id", customer!.userId)
    .eq("is_default", true)
    .single();
  if (addressError) throw addressError;
  const start = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  start.setUTCHours(10, 0, 0, 0);
  return authenticatedClient("customer").from("bookings").insert({
    customer_id: customer!.userId,
    provider_id: fixture.provider.id,
    service_id: fixture.service.id,
    address_id: address!.id,
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    status: "pending",
    notes: "QA_ must be rejected while ineligible",
    price_subtotal: 100,
    price_total: 100,
  });
}

test.describe("booking slot golden path", () => {
  test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/customer.json") });

  test("Customer books an eligible Provider through the real slot picker UI", async ({ page }) => {
    test.slow();
    test.setTimeout(300_000);
    const suffix = Date.now();
    const fixture = await createEligibleMarketplaceFixture(suffix);
    const errors = captureErrors(page, {
      allowHttpErrors: [{ status: 404, url: /instapay\.png/ }],
    });
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

      const [bookingResponse] = await Promise.all([
        page.waitForResponse((response) => response.url().includes("/rest/v1/bookings") && response.request().method() === "POST"),
        page.getByRole("button", { name: /pay/i }).last().click(),
      ]);
      expect(bookingResponse.ok(), await bookingResponse.text()).toBe(true);
      const payload = await bookingResponse.json();
      bookingId = Array.isArray(payload) ? payload[0]?.id : payload?.id;
      expect(bookingId).toBeTruthy();
      await expect(page).toHaveURL(new RegExp(`/booking/${bookingId}`));
      await page.waitForLoadState("networkidle");
      expect(errors.readErrors()).toEqual({ console: [], network: [] });
    } finally {
      await cleanupEligibleMarketplaceFixture(fixture, bookingId);
    }
  });

  test("ineligible Provider cannot load booking slots and recovers after eligibility is restored", async ({ page, browser }) => {
    test.slow();
    test.setTimeout(300_000);
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

      const bookingsBefore = await countCustomerProviderBookings(fixture.provider.id);
      const blockedBooking = await attemptDirectBooking(fixture);
      expect(blockedBooking.error?.code).toBe("23514");
      expect(await countCustomerProviderBookings(fixture.provider.id)).toBe(bookingsBefore);

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
