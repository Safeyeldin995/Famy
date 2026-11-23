import { describe, expect, it } from "vitest";
import {
  paymobCheckoutChannelFromPaymentMetadata,
  resolvePaymobCheckoutChannelForPayment,
} from "../paymobPaymentChannel";

describe("paymobPaymentChannel", () => {
  it("reads channel from payment metadata for checkout retry", () => {
    expect(
      paymobCheckoutChannelFromPaymentMetadata({ channel: "apple_pay", paymob_checkout_channel: "card" }),
    ).toBe("apple_pay");
    expect(
      resolvePaymobCheckoutChannelForPayment({
        metadata: { channel: "google_pay" },
        selectionChannel: undefined,
      }),
    ).toBe("google_pay");
    expect(
      resolvePaymobCheckoutChannelForPayment({
        metadata: { channel: "apple_pay" },
        selectionChannel: "card",
      }),
    ).toBe("apple_pay");
  });

  it("falls back to selection then card", () => {
    expect(
      resolvePaymobCheckoutChannelForPayment({
        metadata: {},
        selectionChannel: "apple_pay",
      }),
    ).toBe("apple_pay");
    expect(resolvePaymobCheckoutChannelForPayment({ metadata: null })).toBe("card");
  });
});