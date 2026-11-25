import { describe, expect, it } from "vitest";
import { paymentCapturedForJoin } from "../sessionAccess";

describe("paymentCapturedForJoin", () => {
  it("allows joining only for captured online or manual-transfer payments", () => {
    expect(paymentCapturedForJoin({ status: "captured", payment_method_type: "online" })).toBe(true);
    expect(paymentCapturedForJoin({ status: "captured", payment_method_type: "manual_transfer" })).toBe(true);
  });
  it("does not unlock the room for a receipt still in review", () => {
    expect(paymentCapturedForJoin({ status: "pending_review", payment_method_type: "manual_transfer" })).toBe(false);
    expect(paymentCapturedForJoin({ status: "captured", payment_method_type: "cash" })).toBe(false);
    expect(paymentCapturedForJoin(null)).toBe(false);
  });
});
