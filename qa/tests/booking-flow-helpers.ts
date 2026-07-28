import { expect, type Page } from "@playwright/test";
import { supabaseAdmin } from "../admin-client.mjs";
import { authenticatedClient } from "../authenticated-client.mjs";
import { readRegistry } from "../registry.mjs";

export async function selectFixtureService(page: Page, fixture: { serviceName: string }) {
  await page.getByRole("button", { name: fixture.serviceName }).click();
}

export async function continueBooking(page: Page) {
  await page.getByRole("button", { name: /^continue$/i }).click();
}

export async function pickFutureDate(page: Page) {
  const dateButtons = page.locator("button").filter({ hasText: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i });
  await expect(dateButtons.first()).toBeVisible({ timeout: 20_000 });
  await dateButtons.nth(2).click();
}

export async function expectSlotsLoaded(page: Page) {
  await page.waitForResponse(
    (response) => response.url().includes("marketplace_provider_booking_settings") && response.ok(),
    { timeout: 30_000 },
  );
  await expect(page.getByText(/no times available/i)).toHaveCount(0, { timeout: 20_000 });
  const slotButton = page.locator("button").filter({ hasText: /:\d{2}/ }).first();
  await expect(slotButton).toBeVisible({ timeout: 20_000 });
  return slotButton;
}

export async function fetchBookingSettings(fixture: { provider: { id: string }; service: { id: string } }) {
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

export async function countCustomerProviderBookings(providerId: string) {
  const registry = readRegistry();
  const customer = registry.users.find((u) => u.key === "customer");
  const { count, error } = await supabaseAdmin.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customer!.userId)
    .eq("provider_id", providerId);
  if (error) throw error;
  return count ?? 0;
}

export function paySubmitButton(page: Page) {
  return page.locator("button.bg-coral").first();
}

export async function walkToPaymentStep(page: Page, fixture: { provider: { id: string }; service: { id: string }; serviceName: string }) {
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
}

export type CreateBookingRpcCapture = {
  requests: Array<{ idempotencyKey: string; postData: string }>;
  responses: Array<{ ok: boolean; bookingId?: string; idempotentReplay?: boolean }>;
};

export function captureCreateBookingRpc(page: Page): CreateBookingRpcCapture {
  const capture: CreateBookingRpcCapture = { requests: [], responses: [] };
  page.on("request", (request) => {
    if (!request.url().includes("/rpc/create_booking") || request.method() !== "POST") return;
    const postData = request.postData() ?? "";
    let idempotencyKey = "";
    try {
      const body = JSON.parse(postData) as { p_idempotency_key?: string };
      idempotencyKey = body.p_idempotency_key ?? "";
    } catch {
      // ignore malformed bodies in capture
    }
    capture.requests.push({ idempotencyKey, postData });
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/rpc/create_booking") || response.request().method() !== "POST") return;
    let bookingId: string | undefined;
    let idempotentReplay: boolean | undefined;
    try {
      const payload = await response.json() as { booking_id?: string; idempotent_replay?: boolean };
      bookingId = payload.booking_id;
      idempotentReplay = payload.idempotent_replay;
    } catch {
      // ignore non-json responses
    }
    capture.responses.push({ ok: response.ok(), bookingId, idempotentReplay });
  });
  return capture;
}
