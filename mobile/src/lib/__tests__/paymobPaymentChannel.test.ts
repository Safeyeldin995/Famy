import { describe, expect, it } from "vitest";
import { paymobChannelForPaymentBlock } from "../paymobPaymentChannel";

describe("paymobChannelForPaymentBlock", () => {
  it("uses stored payment channel when AsyncStorage selection was cleared", () => {
    expect(
      paymobChannelForPaymentBlock({
        payment: { metadata: { channel: "apple_pay" } },
        selection: null,
      }),
    ).toBe("apple_pay");
  });
});