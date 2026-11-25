import { describe, expect, it } from "vitest";
import {
  PAYMOB_WALLET_APPLE_PAY_METHOD_ID,
  paymobChannelForUiMethodId,
  resolveCheckoutPaymentMethod,
  resolvePaymobOnlinePaymentMethod,
} from "../paymobWalletMethods";

describe("paymobWalletMethods", () => {
  it("maps wallet UI ids to Paymob channels", () => {
    expect(paymobChannelForUiMethodId(PAYMOB_WALLET_APPLE_PAY_METHOD_ID)).toBe("apple_pay");
  });

  it("finds the Paymob online row among active methods", () => {
    const method = resolvePaymobOnlinePaymentMethod([
      { id: "cash", code: "cash", method_type: "cash" },
      { id: "p1", code: "paymob", method_type: "online" },
    ]);
    expect(method?.id).toBe("p1");
  });
});
describe("resolveCheckoutPaymentMethod", () => {
  const card = { id: "m-card", code: "paymob", method_type: "online" };
  const cash = { id: "m-cash", code: "cash", method_type: "cash" };
  it("returns the chosen method, or the Paymob method for wallet channels", () => {
    expect(resolveCheckoutPaymentMethod("m-cash", [card, cash], card)).toBe(cash);
    expect(resolveCheckoutPaymentMethod(PAYMOB_WALLET_APPLE_PAY_METHOD_ID, [card, cash], card)).toBe(card);
  });
  it("returns null instead of crashing when the method is gone", () => {
    expect(resolveCheckoutPaymentMethod("m-gone", [card], card)).toBeNull();
    expect(resolveCheckoutPaymentMethod("m-cash", undefined, undefined)).toBeNull();
    expect(resolveCheckoutPaymentMethod(PAYMOB_WALLET_APPLE_PAY_METHOD_ID, [cash], undefined)).toBeNull();
  });
});
