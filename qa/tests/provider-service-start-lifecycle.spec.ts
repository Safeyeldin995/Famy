import { expect, test, type Page } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { registerE2eRunResource } from "../registry.mjs";
import { captureErrors } from "./helpers";
import { paySubmitButton, walkToPaymentStep } from "./booking-flow-helpers";
import {
  cleanupEligibleMarketplaceFixture,
  createEligibleMarketplaceFixture,
} from "./marketplace-fixtures.mjs";

function isBookingPatchForId(bookingId: string) {
  return (response: {
    url: () => string;
    request: () => { method: () => string };
    ok: () => boolean;
  }) =>
    response.url().includes("/rest/v1/bookings") &&
    response.request().method() === "PATCH" &&
    response.ok() &&
    new URL(response.url()).searchParams.get("id") === `eq.${bookingId}`;
}

async function expectBookingStatus(bookingId: string, status: string) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .single();
  expect(error).toBeFalsy();
  expect(data?.status).toBe(status);
}

async function expectStatusHistory(bookingId: string, expectedToStatuses: string[]) {
  const { data, error } = await supabaseAdmin
    .from("booking_status_history")
    .select("from_status, to_status")
    .eq("booking_id", bookingId)
    .order("created_at");
  expect(error).toBeFalsy();
  expect(data?.map((row) => row.to_status)).toEqual(expectedToStatuses);
}

async function expectTransitionOnce(bookingId: string, fromStatus: string, toStatus: string) {
  const { data, error } = await supabaseAdmin
    .from("booking_status_history")
    .select("from_status, to_status")
    .eq("booking_id", bookingId)
    .eq("from_status", fromStatus)
    .eq("to_status", toStatus);
  expect(error).toBeFalsy();
  expect(data).toHaveLength(1);
}

async function providerPatchTransition(providerPage: Page, bookingId: string, buttonName: RegExp) {
  const [response] = await Promise.all([
    providerPage.waitForResponse(isBookingPatchForId(bookingId)),
    providerPage.getByRole("button", { name: buttonName }).click(),
  ]);
  expect(response.ok(), await response.text()).toBe(true);
}

async function expectProviderStatusBadge(providerPage: Page, statusLabel: RegExp) {
  await expect(
    providerPage
      .locator("span.inline-flex.items-center.gap-1.rounded-full")
      .filter({ hasText: statusLabel }),
  ).toBeVisible({ timeout: 20_000 });
}

async function expectCustomerConfirmedUpcoming(customerPage: Page, bookingId: string) {
  await customerPage.goto(`/booking/${bookingId}`, {
    waitUntil: "networkidle",
  });
  await expect(customerPage.getByText(/Booking #.* is confirmed\./i)).toBeVisible({
    timeout: 20_000,
  });
}

async function expectCustomerTrackingState(
  customerPage: Page,
  bookingId: string,
  expectedHeadline: RegExp,
) {
  await customerPage.goto(`/booking/${bookingId}`, {
    waitUntil: "networkidle",
  });
  await expect(customerPage).toHaveURL(new RegExp(`/booking/${bookingId}$`));
  const trackingHeadline = customerPage
    .getByRole("paragraph")
    .filter({ hasText: expectedHeadline });
  await expect(trackingHeadline).toHaveCount(1);
  await expect(trackingHeadline).toBeVisible({ timeout: 20_000 });
}

async function acceptBookingThroughProviderUi(
  customerPage: Page,
  providerPage: Page,
  bookingId: string,
) {
  await providerPage.goto("/pro/bookings");
  const bookingLink = providerPage.locator(`a[href="/pro/booking/${bookingId}"]`);
  await expect(bookingLink).toBeVisible({ timeout: 30_000 });
  await bookingLink.click();
  await expect(providerPage.getByRole("button", { name: /^accept$/i })).toBeVisible({
    timeout: 20_000,
  });
  await providerPatchTransition(providerPage, bookingId, /^accept$/i);
  await expectBookingStatus(bookingId, "confirmed");
  await expectTransitionOnce(bookingId, "pending", "confirmed");
  await expectCustomerConfirmedUpcoming(customerPage, bookingId);
}

test.describe("provider service start lifecycle", () => {
  test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/customer.json") });

  test("provider advances a confirmed booking through on_the_way, arrived, and in_progress", async ({
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

      await acceptBookingThroughProviderUi(page, providerPage, bookingId!);
      await providerPage.goto(`/pro/booking/${bookingId}`);

      await providerPatchTransition(providerPage, bookingId!, /^on the way$/i);
      await expectBookingStatus(bookingId!, "on_the_way");
      await expectTransitionOnce(bookingId!, "confirmed", "on_the_way");
      await expectStatusHistory(bookingId!, ["pending", "confirmed", "on_the_way"]);
      await expectProviderStatusBadge(providerPage, /^On the way$/i);
      await expectCustomerTrackingState(page, bookingId!, /is on the way to your place\.$/i);

      await providerPage.goto(`/pro/booking/${bookingId}`);
      await providerPatchTransition(providerPage, bookingId!, /^i've arrived$/i);
      await expectBookingStatus(bookingId!, "arrived");
      await expectTransitionOnce(bookingId!, "on_the_way", "arrived");
      await expectStatusHistory(bookingId!, ["pending", "confirmed", "on_the_way", "arrived"]);
      await expectProviderStatusBadge(providerPage, /^Arrived$/i);
      await expectCustomerTrackingState(page, bookingId!, /has arrived at your location\.$/i);

      await page.goto(`/booking/${bookingId}`, {
        waitUntil: "networkidle",
      });
      await page.getByRole("button", { name: /^confirm arrival$/i }).click();
      const confirmDialog = page.getByRole("dialog", {
        name: /^confirm your provider has arrived\?$/i,
      });
      await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
      const [arrivalConfirmResponse] = await Promise.all([
        page.waitForResponse(isBookingPatchForId(bookingId!)),
        confirmDialog.getByRole("button", { name: /^confirm$/i }).click(),
      ]);
      expect(arrivalConfirmResponse.ok(), await arrivalConfirmResponse.text()).toBe(true);
      await expectBookingStatus(bookingId!, "arrival_confirmed");
      await expectTransitionOnce(bookingId!, "arrived", "arrival_confirmed");
      await expectStatusHistory(bookingId!, [
        "pending",
        "confirmed",
        "on_the_way",
        "arrived",
        "arrival_confirmed",
      ]);
      await expectCustomerTrackingState(
        page,
        bookingId!,
        /^Arrival confirmed\..*will start shortly\.$/i,
      );

      await providerPage.goto(`/pro/booking/${bookingId}`);
      await providerPatchTransition(providerPage, bookingId!, /^start service$/i);
      await expectBookingStatus(bookingId!, "in_progress");
      await expectTransitionOnce(bookingId!, "arrival_confirmed", "in_progress");
      await expectStatusHistory(bookingId!, [
        "pending",
        "confirmed",
        "on_the_way",
        "arrived",
        "arrival_confirmed",
        "in_progress",
      ]);
      await expectProviderStatusBadge(providerPage, /^In progress$/i);
      await expectCustomerTrackingState(
        page,
        bookingId!,
        /is currently working on your service\.$/i,
      );

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
