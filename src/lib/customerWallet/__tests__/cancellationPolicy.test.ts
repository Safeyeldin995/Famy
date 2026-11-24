import { describe, expect, it } from "vitest";
import {
  cancellationFeeForTotal,
  cancellationPolicyForMode,
  walletRefundOnCustomerCancel,
} from "@/lib/customerWallet/cancellationPolicy";

describe("cancellationPolicyForMode", () => {
  it("defaults online to 4h free and 50% fee", () => {
    expect(cancellationPolicyForMode(null, "online")).toEqual({
      fee_mode: "percent",
      fee_value: 50,
      free_cancel_hours: 4,
    });
  });

  it("uses nested online settings when present", () => {
    expect(
      cancellationPolicyForMode(
        {
          in_person: { fee_mode: "fixed", fee_value: 0, free_cancel_hours: 2 },
          online: { fee_mode: "percent", fee_value: 40, free_cancel_hours: 6 },
        },
        "online",
      ),
    ).toEqual({ fee_mode: "percent", fee_value: 40, free_cancel_hours: 6 });
  });
});

describe("wallet refund math", () => {
  it("full refund when fee is zero", () => {
    const policy = cancellationPolicyForMode(null, "online");
    const fee = cancellationFeeForTotal(200, policy);
    expect(fee).toBe(100);
    expect(walletRefundOnCustomerCancel(200, fee)).toBe(100);
  });

  it("never refunds more than paid", () => {
    expect(walletRefundOnCustomerCancel(80, 100)).toBe(0);
  });
});