import { describe, expect, it } from "vitest";
import {
  PAYMOB_WALLET_APPLE_PAY_METHOD_ID,
  paymobChannelForUiMethodId,
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