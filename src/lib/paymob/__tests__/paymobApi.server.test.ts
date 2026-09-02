import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPaymobIntention,
  PaymobIntentionIndeterminateError,
  PaymobIntentionRejectedError,
} from "../paymobApi.server";
import type { PaymobConfig } from "../paymobConfig.server";

const config: PaymobConfig = {
  secretKey: "test-secret",
  publicKey: "test-public",
  hmacSecret: "test-hmac",
  integrationId: 123456,
  baseUrl: "https://accept.paymob.com",
  notificationUrl: "https://example.test/functions/v1/paymob-webhook",
  appOrigin: "http://localhost:8099",
};

const input = {
  amountCents: 10000,
  currency: "EGP",
  specialReference: "pay-1",
  notificationUrl: config.notificationUrl,
  redirectionUrl: "http://localhost:8099/booking/book-1?paymob_return=1",
  billingData: {
    first_name: "Famy",
    last_name: "Customer",
    phone_number: "+201000000000",
    email: "customer@famy.app",
    street: "NA",
    building: "NA",
    floor: "NA",
    apartment: "NA",
    city: "Cairo",
    country: "EGY",
    state: "Cairo",
  },
  items: [{ name: "Booking", amount: 10000, quantity: 1 }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPaymobIntention failure classification", () => {
  it("throws PaymobIntentionIndeterminateError when the network request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network reset");
      }),
    );

    await expect(createPaymobIntention(config, input)).rejects.toBeInstanceOf(
      PaymobIntentionIndeterminateError,
    );
  });

  it("throws PaymobIntentionRejectedError on a clean non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => "bad request",
      })),
    );

    await expect(createPaymobIntention(config, input)).rejects.toBeInstanceOf(
      PaymobIntentionRejectedError,
    );
  });

  it("throws PaymobIntentionIndeterminateError when a 2xx response body can't be parsed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      })),
    );

    await expect(createPaymobIntention(config, input)).rejects.toBeInstanceOf(
      PaymobIntentionIndeterminateError,
    );
  });

  it("throws PaymobIntentionIndeterminateError when a 2xx response body is missing required fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: "pending" }),
      })),
    );

    await expect(createPaymobIntention(config, input)).rejects.toBeInstanceOf(
      PaymobIntentionIndeterminateError,
    );
  });

  it("returns the checkout details on a well-formed 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: "intent-1", client_secret: "secret-1" }),
      })),
    );

    const result = await createPaymobIntention(config, input);
    expect(result.intentionId).toBe("intent-1");
    expect(result.clientSecret).toBe("secret-1");
    expect(result.checkoutUrl).toContain("secret-1");
  });
});
