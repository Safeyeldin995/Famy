import { describe, expect, it, vi } from "vitest";
import { createPaymobCheckoutForPayment, type SupabaseAdminClient } from "../paymobCheckout.server";
import {
  createPaymobIntention,
  PaymobIntentionIndeterminateError,
  PaymobIntentionRejectedError,
} from "../paymobApi.server";

type PaymentRecord = {
  id: string;
  booking_id: string;
  customer_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_method_code: string;
  payment_method_type: string;
  provider_ref: string | null;
  metadata: Record<string, unknown>;
};

function createMockSupabase(initialPayment: PaymentRecord) {
  const payment = { ...initialPayment, metadata: { ...initialPayment.metadata } };
  const state = { failNextStore: false };
  let chain = Promise.resolve();

  const withLock = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    const run = chain.then(fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    payment,
    state,
    async rpc(fn: string, args: Record<string, unknown>) {
      return withLock(async () => {
        if (fn === "paymob_reserve_checkout") {
          const checkoutUrl = payment.metadata.paymob_checkout_url;
          const intentionId = payment.metadata.paymob_intention_id ?? payment.provider_ref;
          if (typeof checkoutUrl === "string" && typeof intentionId === "string") {
            return {
              data: { reused: true, checkout_url: checkoutUrl, payment_id: payment.id },
              error: null,
            };
          }
          if (payment.metadata.paymob_checkout_reservation) {
            return {
              data: null,
              error: { message: "Paymob checkout is already in progress for this payment" },
            };
          }
          payment.metadata = {
            ...payment.metadata,
            paymob_checkout_reservation: crypto.randomUUID(),
            paymob_checkout_reserved_at: new Date().toISOString(),
          };
          return { data: { reused: false, payment_id: payment.id }, error: null };
        }
        if (fn === "paymob_store_checkout_intention") {
          if (state.failNextStore) {
            state.failNextStore = false;
            return { data: null, error: { message: "simulated storage failure" } };
          }
          payment.provider_ref = String(args.p_intention_id);
          payment.metadata = {
            ...payment.metadata,
            paymob_intention_id: args.p_intention_id,
            paymob_checkout_url: args.p_checkout_url,
            paymob_checkout_started_at: new Date().toISOString(),
          };
          delete payment.metadata.paymob_checkout_reservation;
          return { data: null, error: null };
        }
        if (fn === "paymob_release_checkout_reservation") {
          delete payment.metadata.paymob_checkout_reservation;
          delete payment.metadata.paymob_checkout_reserved_at;
          return { data: null, error: null };
        }
        return { data: null, error: { message: `unknown rpc ${fn}` } };
      });
    },
    from(table: string) {
      const buildPaymentRow = () => payment;
      const buildBookingRow = () => ({
        id: payment.booking_id,
        customer_id: payment.customer_id,
        price_total: payment.amount,
        currency: payment.currency,
        service: { name_en: "Test service", name_ar: null },
      });
      const buildProfileRow = () => ({ full_name: "Test User", phone: "+201012345678" });

      const chain = {
        eq: () => chain,
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({ data: buildPaymentRow(), error: null }),
          }),
        }),
        maybeSingle: async () => ({
          data:
            table === "payments"
              ? buildPaymentRow()
              : table === "profiles"
                ? buildProfileRow()
                : null,
          error: null,
        }),
        single: async () => ({
          data: table === "bookings" ? buildBookingRow() : buildProfileRow(),
          error: null,
        }),
      };

      return {
        select: () => chain,
      };
    },
  };
}

let releaseIntention: (() => void) | null = null;
let intentionGate = new Promise<void>((resolve) => {
  releaseIntention = resolve;
});

vi.mock("../paymobConfig.server", () => ({
  readPaymobConfig: () => ({
    secretKey: "test-secret",
    publicKey: "test-public",
    hmacSecret: "test-hmac",
    integrationId: 123456,
    baseUrl: "https://accept.paymob.com",
    notificationUrl: "https://example.test/functions/v1/paymob-webhook",
    appOrigin: "http://localhost:8099",
  }),
  buildPaymobBookingReturnUrl: (origin: string, bookingId: string) =>
    `${origin}/booking/${bookingId}?paymob_return=1`,
}));

vi.mock("../paymobApi.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../paymobApi.server")>();
  return {
    ...actual,
    createPaymobIntention: vi.fn(async (_config, input) => {
      await intentionGate;
      const intentionId = `intent-${input.specialReference}`;
      return {
        checkoutUrl: `https://accept.paymob.com/unifiedcheckout/?publicKey=test&clientSecret=${intentionId}`,
        intentionId,
        clientSecret: intentionId,
      };
    }),
  };
});

describe("createPaymobCheckoutForPayment concurrency", () => {
  it("rejects a second checkout while the first intention is still being created, then reuses the stored checkout", async () => {
    intentionGate = new Promise<void>((resolve) => {
      releaseIntention = resolve;
    });

    const mock = createMockSupabase({
      id: "pay-1",
      booking_id: "book-1",
      customer_id: "user-1",
      amount: 250,
      currency: "EGP",
      status: "pending",
      payment_method_code: "paymob",
      payment_method_type: "online",
      provider_ref: null,
      metadata: {},
    });

    const firstPromise = createPaymobCheckoutForPayment({
      supabaseAdmin: mock as unknown as SupabaseAdminClient,
      userId: "user-1",
      bookingId: "book-1",
      paymentId: "pay-1",
    });

    await Promise.resolve();
    await expect(
      createPaymobCheckoutForPayment({
        supabaseAdmin: mock as unknown as SupabaseAdminClient,
        userId: "user-1",
        bookingId: "book-1",
        paymentId: "pay-1",
      }),
    ).rejects.toThrow("already in progress");

    releaseIntention?.();
    const first = await firstPromise;

    const reused = await createPaymobCheckoutForPayment({
      supabaseAdmin: mock as unknown as SupabaseAdminClient,
      userId: "user-1",
      bookingId: "book-1",
      paymentId: "pay-1",
    });

    expect(reused.checkoutUrl).toBe(first.checkoutUrl);
    expect(mock.payment.metadata.paymob_intention_id).toBe("intent-pay-1");
  });

  it("releases the reservation when Paymob explicitly rejects the intention request, allowing an immediate retry", async () => {
    intentionGate = Promise.resolve();

    const mock = createMockSupabase({
      id: "pay-2",
      booking_id: "book-2",
      customer_id: "user-1",
      amount: 100,
      currency: "EGP",
      status: "pending",
      payment_method_code: "paymob",
      payment_method_type: "online",
      provider_ref: null,
      metadata: {},
    });

    vi.mocked(createPaymobIntention).mockRejectedValueOnce(
      new PaymobIntentionRejectedError("Could not start Paymob checkout."),
    );

    await expect(
      createPaymobCheckoutForPayment({
        supabaseAdmin: mock as unknown as SupabaseAdminClient,
        userId: "user-1",
        bookingId: "book-2",
        paymentId: "pay-2",
      }),
    ).rejects.toThrow("Could not start Paymob checkout.");

    expect(mock.payment.metadata.paymob_checkout_reservation).toBeUndefined();

    const retried = await createPaymobCheckoutForPayment({
      supabaseAdmin: mock as unknown as SupabaseAdminClient,
      userId: "user-1",
      bookingId: "book-2",
      paymentId: "pay-2",
    });

    expect(retried.checkoutUrl).toContain("intent-pay-2");
  });

  it("keeps the reservation when the Paymob request outcome is indeterminate, blocking an immediate retry", async () => {
    intentionGate = Promise.resolve();

    const mock = createMockSupabase({
      id: "pay-3",
      booking_id: "book-3",
      customer_id: "user-1",
      amount: 100,
      currency: "EGP",
      status: "pending",
      payment_method_code: "paymob",
      payment_method_type: "online",
      provider_ref: null,
      metadata: {},
    });

    vi.mocked(createPaymobIntention).mockRejectedValueOnce(
      new PaymobIntentionIndeterminateError("Could not reach Paymob to start checkout."),
    );

    await expect(
      createPaymobCheckoutForPayment({
        supabaseAdmin: mock as unknown as SupabaseAdminClient,
        userId: "user-1",
        bookingId: "book-3",
        paymentId: "pay-3",
      }),
    ).rejects.toThrow("Could not reach Paymob to start checkout.");

    expect(mock.payment.metadata.paymob_checkout_reservation).toBeDefined();

    await expect(
      createPaymobCheckoutForPayment({
        supabaseAdmin: mock as unknown as SupabaseAdminClient,
        userId: "user-1",
        bookingId: "book-3",
        paymentId: "pay-3",
      }),
    ).rejects.toThrow("already in progress");
  });

  it("keeps the reservation when Paymob succeeds but local storage fails, blocking an immediate retry", async () => {
    intentionGate = Promise.resolve();

    const mock = createMockSupabase({
      id: "pay-4",
      booking_id: "book-4",
      customer_id: "user-1",
      amount: 100,
      currency: "EGP",
      status: "pending",
      payment_method_code: "paymob",
      payment_method_type: "online",
      provider_ref: null,
      metadata: {},
    });

    mock.state.failNextStore = true;

    await expect(
      createPaymobCheckoutForPayment({
        supabaseAdmin: mock as unknown as SupabaseAdminClient,
        userId: "user-1",
        bookingId: "book-4",
        paymentId: "pay-4",
      }),
    ).rejects.toThrow("Could not save Paymob checkout details.");

    expect(mock.payment.metadata.paymob_checkout_reservation).toBeDefined();

    await expect(
      createPaymobCheckoutForPayment({
        supabaseAdmin: mock as unknown as SupabaseAdminClient,
        userId: "user-1",
        bookingId: "book-4",
        paymentId: "pay-4",
      }),
    ).rejects.toThrow("already in progress");
  });
});
