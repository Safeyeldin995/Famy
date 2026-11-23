import { describe, expect, it } from "vitest";
import { refundOwed } from "@/lib/payments/refundOwed";

describe("refundOwed", () => {
  it("returns false when refund was settled via wallet metadata", () => {
    expect(
      refundOwed({
        bookingStatus: "cancelled",
        paymentStatus: "captured",
        methodType: "online",
        metadata: { refund_settled_via_wallet: true },
      }),
    ).toBe(false);
  });

  it("still shows refund owed when cancelled and money held without wallet settlement", () => {
    expect(
      refundOwed({
        bookingStatus: "cancelled",
        paymentStatus: "captured",
        methodType: "online",
      }),
    ).toBe(true);
  });
});