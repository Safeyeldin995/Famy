import { describe, expect, it } from "vitest";
import { onlineWebPayMode } from "../onlineWebPayMode";

describe("onlineWebPayMode", () => {
  it("starts online checkout when there is no payment yet or an online one", () => {
    expect(onlineWebPayMode(null)).toBe("online");
    expect(onlineWebPayMode({ status: "pending", payment_method_type: "online" })).toBe("online");
  });

  it("hands manual transfers without a receipt to the transfer/receipt flow, never to checkout", () => {
    expect(onlineWebPayMode({ status: "pending_review", payment_method_type: "manual_transfer" })).toBe(
      "manual_transfer",
    );
    expect(onlineWebPayMode({ status: "rejected", payment_method_type: "manual_transfer" })).toBe(
      "manual_transfer",
    );
  });

  it("hides payment once money is held", () => {
    expect(onlineWebPayMode({ status: "captured", payment_method_type: "online" })).toBe("hidden");
    expect(
      onlineWebPayMode({ status: "pending_review", payment_method_type: "manual_transfer", proof_path: "p/1.jpg" }),
    ).toBe("hidden");
  });
});
