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
import { readRegistry } from "../registry.mjs";
import { registerE2eRunResource } from "../registry.mjs";
import { paySubmitButton, walkToPaymentStep } from "./booking-flow-helpers";
import { captureErrors } from "./helpers";
import {
  cleanupEligibleMarketplaceFixture,
  createEligibleMarketplaceFixture,
} from "./marketplace-fixtures.mjs";

const REVIEW_RATING = 4;
const reviewComment = () => `QA review ${Date.now()} — great service`;

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
    expect(data).toMatchObject({ id: bookingId, status: transition.status });
  }
}

async function completeBookingViaUi(
  bookingId: string,
  customerPage: Page,
  providerPage: Page,
) {
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

  await customerPage.goto(`/booking/${bookingId}`);
  const openCompletionDialog = customerPage.getByRole("button", {
    name: /^yes, it's done$/i,
  });
  await expect(openCompletionDialog).toHaveCount(1);
  await openCompletionDialog.click();

  const completionDialog = customerPage.getByRole("dialog", {
    name: /^is the service done\?$/i,
  });
  await expect(completionDialog).toBeVisible({ timeout: 20_000 });
  const confirmCompletion = completionDialog.getByRole("button", {
    name: /^yes, it's done$/i,
  });

  const [completeResponse] = await Promise.all([
    customerPage.waitForResponse(isBookingPatchForId(bookingId)),
    confirmCompletion.click(),
  ]);
  expect(completeResponse.ok(), await completeResponse.text()).toBe(true);
  await expectBooking(bookingId, "completed", { completed: true });
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

async function readRatingsSummary(providerId: string) {
  const { data, error } = await supabaseAdmin
    .from("ratings_summary")
    .select("provider_id, rating_avg, rating_count")
    .eq("provider_id", providerId)
    .maybeSingle();
  expect(error).toBeFalsy();
  return {
    rating_avg: Number(data?.rating_avg ?? 0),
    rating_count: Number(data?.rating_count ?? 0),
  };
}

test.describe("ratings and reviews golden path", () => {
  test.use({
    storageState: path.resolve(process.cwd(), "qa/.auth/customer.json"),
  });

  test("completed booking review persists and appears on provider profile", async ({
    page,
    browser,
  }) => {
    test.setTimeout(420_000);

    const registry = readRegistry();
    const customer = registry.users.find((u) => u.key === "customer");
    expect(customer).toBeTruthy();

    let fixture:
      | Awaited<ReturnType<typeof createEligibleMarketplaceFixture>>
      | undefined;
    let bookingId: string | undefined;
    let providerContext: BrowserContext | undefined;
    let customerErrors: ReturnType<typeof captureErrors> | undefined;
    let providerErrors: ReturnType<typeof captureErrors> | undefined;
    const comment = reviewComment();

    try {
      fixture = await createEligibleMarketplaceFixture(Date.now());
      const providerId = fixture.provider.id;
      const baselineSummary = await readRatingsSummary(providerId);

      providerContext = await browser.newContext({
        storageState: path.resolve(process.cwd(), "qa/.auth/provider.json"),
      });
      const providerPage = await providerContext.newPage();
      customerErrors = captureErrors(page);
      providerErrors = captureErrors(providerPage);

      bookingId = await createFixtureBooking(page, fixture);
      registerE2eRunResource("bookingIds", bookingId);

      await transitionThroughSanctionedSetup(bookingId);
      await completeBookingViaUi(bookingId, page, providerPage);

      await page.goto(`/booking/${bookingId}`);
      await expect(
        page.getByText(/how was your experience/i),
      ).toBeVisible({ timeout: 20_000 });

      await page.getByRole("button", { name: "4", exact: true }).click();
      await page.getByPlaceholder(/write a quick review/i).fill(comment);

      const [reviewResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/rest/v1/reviews") &&
            response.request().method() === "POST",
          { timeout: 60_000 },
        ),
        page.getByRole("button", { name: /^submit rating$/i }).click(),
      ]);
      expect(reviewResponse.ok(), await reviewResponse.text()).toBe(true);

      await expect(
        page.getByText(/thanks for your feedback!/i),
      ).toBeVisible({ timeout: 20_000 });

      const { data: reviewRow, error: reviewError } = await supabaseAdmin
        .from("reviews")
        .select("id, booking_id, customer_id, provider_id, rating, comment")
        .eq("booking_id", bookingId)
        .single();
      expect(reviewError).toBeFalsy();
      expect(reviewRow).toMatchObject({
        booking_id: bookingId,
        customer_id: customer!.userId,
        provider_id: providerId,
        rating: REVIEW_RATING,
        comment,
      });

      const updatedSummary = await readRatingsSummary(providerId);
      expect(updatedSummary.rating_count).toBe(baselineSummary.rating_count + 1);
      const expectedAvg =
        baselineSummary.rating_count === 0
          ? REVIEW_RATING
          : (baselineSummary.rating_avg * baselineSummary.rating_count +
              REVIEW_RATING) /
            (baselineSummary.rating_count + 1);
      expect(Number(updatedSummary.rating_avg.toFixed(2))).toBe(
        Number(expectedAvg.toFixed(2)),
      );

      await page.goto(`/provider/${providerId}`);
      await expect(page.getByText(comment)).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByRole("heading", {
          name: new RegExp(`Reviews \\(${updatedSummary.rating_count}\\)`, "i"),
        }),
      ).toBeVisible();
      await expect(
        page.getByText(
          new RegExp(
            `${REVIEW_RATING}\\s*\\(${updatedSummary.rating_count}\\)`,
          ),
        ),
      ).toBeVisible();

      await page.goto(`/booking/${bookingId}`);
      await expect(
        page.getByText(/thanks for your feedback!/i),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByRole("button", { name: /^submit rating$/i }),
      ).toHaveCount(0);
      await expect(page.getByPlaceholder(/share your experience/i)).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("button", { name: "1", exact: true }),
      ).toHaveCount(0);

      expect(customerErrors.readErrors()).toEqual({ console: [], network: [] });
      expect(providerErrors.readErrors()).toEqual({ console: [], network: [] });
    } finally {
      customerErrors?.stopCapture();
      providerErrors?.stopCapture();
      if (bookingId) {
        await supabaseAdmin.from("reviews").delete().eq("booking_id", bookingId);
      }
      try {
        await providerContext?.close();
      } finally {
        if (fixture) {
          await cleanupEligibleMarketplaceFixture(fixture, bookingId);
        }
      }
    }
  });
});
