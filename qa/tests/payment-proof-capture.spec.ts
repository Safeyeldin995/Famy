import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { authenticatedClient } from "../authenticated-client.mjs";
import { supabaseAdmin } from "../admin-client.mjs";
import { registerE2eRunResource } from "../registry.mjs";
import {
  paySubmitButton,
  walkToPaymentStep,
} from "./booking-flow-helpers";
import { captureErrors } from "./helpers";
import {
  cleanupEligibleMarketplaceFixture,
  createEligibleMarketplaceFixture,
} from "./marketplace-fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROOF_FIXTURE = path.resolve(__dirname, "fixtures/payment-proof.png");

async function selectManualTransferPayment(page: Page) {
  const instapayOption = page.getByRole("button", { name: /instapay/i });
  await expect(instapayOption).toBeVisible({ timeout: 20_000 });
  await instapayOption.click();
}

async function createManualTransferBooking(
  page: Page,
  fixture: Awaited<ReturnType<typeof createEligibleMarketplaceFixture>>,
) {
  await walkToPaymentStep(page, fixture);
  await selectManualTransferPayment(page);
  const [response, paymentResponse] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes("/rpc/create_booking") &&
        candidate.request().method() === "POST",
    ),
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes("/rest/v1/payments") &&
        candidate.request().method() === "POST",
      { timeout: 60_000 },
    ),
    paySubmitButton(page).click(),
  ]);
  expect(response.ok(), await response.text()).toBe(true);
  expect(paymentResponse.ok(), await paymentResponse.text()).toBe(true);
  const payload = (await response.json()) as { booking_id?: string };
  expect(payload.booking_id).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/booking/${payload.booking_id}$`), {
    timeout: 30_000,
  });
  return payload.booking_id!;
}

async function readLatestPayment(bookingId: string) {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select(
      "id, booking_id, customer_id, status, proof_path, proof_uploaded_at, payment_method_type",
    )
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  expect(error).toBeFalsy();
  return data!;
}

test.describe("payment proof capture golden path", () => {
  test.use({
    storageState: path.resolve(process.cwd(), "qa/.auth/customer.json"),
  });

  test("manual-transfer proof upload persists and locks after provider review", async ({
    page,
    browser,
  }) => {
    test.setTimeout(360_000);

    let fixture:
      | Awaited<ReturnType<typeof createEligibleMarketplaceFixture>>
      | undefined;
    let bookingId: string | undefined;
    let paymentId: string | undefined;
    let proofPath: string | undefined;
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

      bookingId = await createManualTransferBooking(page, fixture);
      registerE2eRunResource("bookingIds", bookingId);

      const paymentBeforeUpload = await readLatestPayment(bookingId);
      paymentId = paymentBeforeUpload.id;
      expect(paymentBeforeUpload.status).toBe("pending_review");
      expect(paymentBeforeUpload.payment_method_type).toBe("manual_transfer");
      expect(paymentBeforeUpload.proof_path).toBeNull();

      await page.goto(`/booking/${bookingId}`);
      await expect(page.getByText(/upload receipt/i)).toBeVisible({
        timeout: 20_000,
      });

      const fileInput = page.locator('input[type="file"]');
      await expect(fileInput).toHaveCount(1);

      const [storageUpload, paymentPatch] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/storage/v1/object/payment-proofs/") &&
            response.request().method() === "POST",
          { timeout: 60_000 },
        ),
        page.waitForResponse(
          (response) =>
            response.url().includes("/rest/v1/payments") &&
            response.request().method() === "PATCH",
          { timeout: 60_000 },
        ),
        fileInput.setInputFiles(PROOF_FIXTURE),
      ]);
      expect(storageUpload.ok(), await storageUpload.text()).toBe(true);
      expect(paymentPatch.ok(), await paymentPatch.text()).toBe(true);

      await expect(
        page.getByText(/receipt uploaded — awaiting famy review/i),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/upload receipt/i)).toHaveCount(0);

      const paymentAfterUpload = await readLatestPayment(bookingId);
      expect(paymentAfterUpload.proof_path).toBeTruthy();
      expect(paymentAfterUpload.proof_uploaded_at).toBeTruthy();
      expect(paymentAfterUpload.status).toBe("pending_review");
      proofPath = paymentAfterUpload.proof_path!;

      await providerPage.goto(`/pro/booking/${bookingId}`);
      await expect(
        providerPage.getByText(/receipt uploaded — awaiting famy review/i),
      ).toBeVisible({ timeout: 20_000 });

      const [signedUrlResponse] = await Promise.all([
        providerPage.waitForResponse(
          (response) =>
            response.url().includes("/storage/v1/object/sign/payment-proofs/") &&
            response.request().method() === "POST" &&
            response.ok(),
          { timeout: 30_000 },
        ),
        providerPage.getByLabel(/view receipt/i).first().click(),
      ]);
      const signedPayload = (await signedUrlResponse.json()) as {
        signedURL?: string;
      };
      expect(signedPayload.signedURL).toBeTruthy();
      expect(signedPayload.signedURL).toMatch(/token=/i);
      expect(signedPayload.signedURL).not.toMatch(/^https?:\/\/[^/]+\/storage\/v1\/object\/public\//);

      await providerPage.getByRole("button", { name: /^reject$/i }).click();
      await expect(
        providerPage.getByText(/reject this payment/i),
      ).toBeVisible({ timeout: 10_000 });
      const [rejectResponse] = await Promise.all([
        providerPage.waitForResponse(
          (response) =>
            response.url().includes("/rest/v1/payments") &&
            response.request().method() === "PATCH" &&
            response.ok(),
        ),
        providerPage.getByRole("button", { name: /confirm reject/i }).click(),
      ]);
      expect(rejectResponse.ok(), await rejectResponse.text()).toBe(true);

      const paymentAfterReview = await readLatestPayment(bookingId);
      expect(paymentAfterReview.status).toBe("rejected");
      const priorProofPath = paymentAfterReview.proof_path;

      const { data: replayRows, error: repeatUploadError } =
        await authenticatedClient("customer")
          .from("payments")
          .update({
            proof_path: `${bookingId}/proof-replay.png`,
            proof_uploaded_at: new Date().toISOString(),
          })
          .eq("id", paymentId)
          .select("id");
      expect(repeatUploadError).toBeFalsy();
      expect(replayRows ?? []).toHaveLength(0);

      const paymentAfterReplay = await readLatestPayment(bookingId);
      expect(paymentAfterReplay.proof_path).toBe(priorProofPath);
      expect(paymentAfterReplay.status).toBe("rejected");

      expect(customerErrors.readErrors()).toEqual({ console: [], network: [] });
      expect(providerErrors.readErrors()).toEqual({ console: [], network: [] });
    } finally {
      customerErrors?.stopCapture();
      providerErrors?.stopCapture();
      if (proofPath) {
        await supabaseAdmin.storage.from("payment-proofs").remove([proofPath]);
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
