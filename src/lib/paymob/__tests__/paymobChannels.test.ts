import { describe, expect, it } from "vitest";
import { parsePaymobCheckoutChannel } from "../paymobChannels";
import {
  isPaymobApplePayConfigured,
  isPaymobGooglePayConfigured,
  readOptionalPaymobIntegrationIdForChannel,
} from "../paymobConfig.server";

describe("parsePaymobCheckoutChannel", () => {
  it("defaults unknown values to card", () => {
    expect(parsePaymobCheckoutChannel(undefined)).toBe("card");
    expect(parsePaymobCheckoutChannel("wallet")).toBe("card");
  });
});

describe("wallet integration env", () => {
  it("detects optional wallet integration ids", () => {
    const env = {
      PAYMOB_SECRET_KEY: "sk",
      PAYMOB_PUBLIC_KEY: "pk",
      PAYMOB_HMAC_SECRET: "hmac",
      PAYMOB_INTEGRATION_ID: "100",
      SUPABASE_URL: "https://example.supabase.co",
      PAYMOB_APPLE_PAY_INTEGRATION_ID: "201",
      PAYMOB_GOOGLE_PAY_INTEGRATION_ID: "202",
    };
    expect(isPaymobApplePayConfigured(env)).toBe(true);
    expect(isPaymobGooglePayConfigured(env)).toBe(true);
    const prev = { ...process.env };
    Object.assign(process.env, env);
    try {
      expect(readOptionalPaymobIntegrationIdForChannel("apple_pay")).toBe(201);
      expect(readOptionalPaymobIntegrationIdForChannel("google_pay")).toBe(202);
    } finally {
      Object.assign(process.env, prev);
    }
  });
});