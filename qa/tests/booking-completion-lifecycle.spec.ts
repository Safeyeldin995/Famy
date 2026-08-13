import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";
import path from "path";
import { authenticatedClient } from "../authenticated-client.mjs";
import { supabaseAdmin } from "../admin-client.mjs";
import { registerE2eRunResource } from "../registry.mjs";
import { paySubmitButton, walkToPaymentStep } from "./booking-flow-helpers";
import { captureErrors } from "./helpers";
import {
  cleanupEligibleMarketplaceFixture,
  createEligibleMarketplaceFixture,
} from "./marketplace-fixtures.mjs";

function isBookingPatchForId(bookingId: string) {
  return (response: Response) =>
    response.url().includes("/rest/v1/bookings") &&
    response.request().method() === "PATCH" &&
    response.ok() &&
    new URL(response.url()).searchParams.get("id") === `eq.${bookingId}`;
}

async function expectBooking(
  bookingId: string,
  expectedStatus: string,
  options: { completed?: boolean } = {},
) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("id, status, completed_at")
    .eq("id", bookingId)
    .single();
  expect(error).toBeFalsy();
  expect(data).toMatchObject({ id: bookingId, status: expectedStatus });
  if (options.completed) expect(data?.completed_at).toBeTruthy();
  else expect(data?.completed_at).toBeNull();
}

async function expectOrderedHistory(
  bookingId: string,
  expectedStatuses: string[],
) {
  const { data, error } = await supabaseAdmin
    .from("booking_status_history")
    .select("from_status, to_status")
    .eq("booking_id", bookingId)
    .order("created_at");
  expect(error).toBeFalsy();
  expect(data?.map((row) => row.to_status)).toEqual(expectedStatuses);
}

async function transitionThroughSanctionedSetup(bookingId: string) {
  const provider = authenticatedClient("provider");
  const customer = authenticatedClient("customer");
  const transitions = [
    { client: provider, status: "confirmed" },
    { client: provider, status: "on_the_way" },
    { client: provider, status: "arrived" },
    { client: customer, status: "arrival_confirmed" },
    { client: provider, status: "in_progress" },
  ];

  for (const transition of transitions) {
    const { data, error } = await transition.client
      .from("bookings")
      .update({ status: transition.status })
      .eq("id", bookingId)
      .select("id, status")
      .single();
    expect(
      error,
      `transition to ${transition.status} failed: ${JSON.stringify(error)}`,
    ).toBeFalsy();
    expect(
      data,
      `transition to ${transition.status} returned unexpected data`,
    ).toMatchObject({
      id: bookingId,
      status: transition.status,
    });
  }
}

async function assertWrongActorRejected(
  bookingId: string,
  actor: "customer" | "provider",
  attemptedStatus: string,
  expectedStatus: string,
) {
  const { error } = await authenticatedClient(actor)
    .from("bookings")
    .update({ status: attemptedStatus })
    .eq("id", bookingId);
  expect(error).toBeTruthy();
  await expectBooking(bookingId, expectedStatus);
}

async function createFixtureBooking(
  page: Page,
  fixture: Awaited<ReturnType<typeof createEligibleMarketplaceFixture>>,
) {
  await walkToPaymentStep(page, fixture);
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes("/rpc/create_booking") &&
        candidate.request().method() === "POST",
    ),
    paySubmitButton(page).click(),
  ]);
  expect(response.ok(), await response.text()).toBe(true);
  const payload = (await response.json()) as { booking_id?: string };
  expect(payload.booking_id).toBeTruthy();
  return payload.booking_id!;
}

test.describe("booking completion lifecycle", () => {
  test.use({
    storageState: path.resolve(process.cwd(), "qa/.auth/customer.json"),
  });

  test("provider requests completion and customer confirms the exact booking", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);

    let fixture:
      | Awaited<ReturnType<typeof createEligibleMarketplaceFixture>>
      | undefined;
    let bookingId: string | undefined;
    let providerContext: BrowserContext | undefined;
    let customerErrors: ReturnType<typeof captureErrors> | undefined;
    let providerErrors: ReturnType<typeof captureErrors> | undefined;

    try {
      fixture = await createEligibleMarketplaceFixture(Date.now());
      providerContext = await browser.newContext({
        storageState: path.resolve(process.cwd(), "qa/.auth/provider.json"),
      });
      const providerPage = await providerContext.newPage();
      customerErrors = captureErrors(page);
      providerErrors = captureErrors(providerPage);

      bookingId = await createFixtureBooking(page, fixture);
      registerE2eRunResource("bookingIds", bookingId);
      await transitionThroughSanctionedSetup(bookingId);
      await expectBooking(bookingId, "in_progress");
      await expectOrderedHistory(bookingId, [
        "pending",
        "confirmed",
        "on_the_way",
        "arrived",
        "arrival_confirmed",
        "in_progress",
      ]);

      await assertWrongActorRejected(
        bookingId,
        "customer",
        "completion_requested",
        "in_progress",
      );

      await providerPage.goto(`/pro/booking/${bookingId}`);
      const requestCompletion = providerPage.getByRole("button", {
        name: /^mark job done$/i,
      });
      await expect(requestCompletion).toBeVisible({ timeout: 20_000 });

      const [requestResponse] = await Promise.all([
        providerPage.waitForResponse(isBookingPatchForId(bookingId)),
        requestCompletion.click(),
      ]);
      expect(requestResponse.ok(), await requestResponse.text()).toBe(true);
      await expectBooking(bookingId, "completion_requested");
      await expectOrderedHistory(bookingId, [
        "pending",
        "confirmed",
        "on_the_way",
        "arrived",
        "arrival_confirmed",
        "in_progress",
        "completion_requested",
      ]);
      const providerStatus = providerPage.getByText(/^Completion requested$/i);
      await expect(providerStatus).toHaveCount(1);
      await expect(providerStatus).toBeVisible({ timeout: 20_000 });

      await assertWrongActorRejected(
        bookingId,
        "provider",
        "completed",
        "completion_requested",
      );

      await page.goto(`/booking/${bookingId}`);
      const openCompletionDialog = page.getByRole("button", {
        name: /^yes, it's done$/i,
      });
      await expect(openCompletionDialog).toHaveCount(1);
      await openCompletionDialog.click();

      const completionDialog = page.getByRole("dialog", {
        name: /^is the service done\?$/i,
      });
      await expect(completionDialog).toBeVisible({ timeout: 20_000 });
      const confirmCompletion = completionDialog.getByRole("button", {
        name: /^yes, it's done$/i,
      });

      const [completeResponse] = await Promise.all([
        page.waitForResponse(isBookingPatchForId(bookingId)),
        confirmCompletion.click(),
      ]);
      expect(completeResponse.ok(), await completeResponse.text()).toBe(true);
      await expectBooking(bookingId, "completed", { completed: true });
      await expectOrderedHistory(bookingId, [
        "pending",
        "confirmed",
        "on_the_way",
        "arrived",
        "arrival_confirmed",
        "in_progress",
        "completion_requested",
        "completed",
      ]);

      await expect(page).toHaveURL(
        (url) => url.pathname === `/booking/${bookingId}`,
      );
      await expect(
        page.getByRole("button", { name: /^yes, it's done$/i }),
      ).toHaveCount(0);

      await providerPage.goto(`/pro/booking/${bookingId}`);
      const completedStatus = providerPage.getByText(/^Completed$/i);
      await expect(completedStatus).toHaveCount(1);
      await expect(completedStatus).toBeVisible({ timeout: 20_000 });
      await expect(
        providerPage.getByRole("button", { name: /back to jobs/i }),
      ).toBeVisible({ timeout: 20_000 });

      expect(customerErrors.readErrors()).toEqual({ console: [], network: [] });
      expect(providerErrors.readErrors()).toEqual({ console: [], network: [] });
    } finally {
      customerErrors?.stopCapture();
      providerErrors?.stopCapture();
      try {
        await providerContext?.close();
      } finally {
        if (fixture)
          await cleanupEligibleMarketplaceFixture(fixture, bookingId);
      }
    }
  });
});
