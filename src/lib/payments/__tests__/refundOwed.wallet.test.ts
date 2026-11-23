import { describe, expect, it } from "vitest";
import { refundOwed } from "@/lib/payments/refundOwed";

describe("refundOwed", () => {
  it("stops showing refund due after wallet settlement", () => {
    expect(
      refundOwed({
        bookingStatus: "cancelled",
        paymentStatus: "refunded",
        methodType: "online",
        walletRefundSettled: true,
      }),
    ).toBe(false);
  });
});