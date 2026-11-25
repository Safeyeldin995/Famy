import { describe, expect, it } from "vitest";
import {
  cancellationPolicyLine,
  customerProblemOptions,
  isCaseDescriptionValid,
  normalizeCancellationPolicy,
  walletCheckoutSplit,
} from "../customerCasesPure";

describe("customerProblemOptions", () => {
  it("offers no-show only while the provider is on the way or arrived", () => {
    for (const s of ["on_the_way", "arrived"]) {
      expect(customerProblemOptions({ bookingStatus: s, serviceMode: "in_person" }).noShow).toBe(true);
    }
    for (const s of ["pending", "confirmed", "in_progress", "completed", "cancelled"]) {
      expect(customerProblemOptions({ bookingStatus: s, serviceMode: "in_person" }).noShow).toBe(false);
    }
  });
  it("hides no-show and dispute when a case is already active", () => {
    const o = customerProblemOptions({
      bookingStatus: "arrived",
      serviceMode: "in_person",
      noShowReports: [{ status: "open" }],
      disputes: [{ status: "info_requested" }],
    });
    expect(o).toEqual({ noShow: false, dispute: false, support: true });
  });
  it("allows a new case after the previous one was resolved", () => {
    const o = customerProblemOptions({
      bookingStatus: "in_progress",
      serviceMode: "in_person",
      disputes: [{ status: "resolved" }],
    });
    expect(o.dispute).toBe(true);
  });
  it("never offers no-show or dispute on online lessons", () => {
    const o = customerProblemOptions({ bookingStatus: "arrived", serviceMode: "online" });
    expect(o.noShow).toBe(false);
    expect(o.dispute).toBe(false);
    expect(o.support).toBe(true);
  });
  it("requires a 10 character description", () => {
    expect(isCaseDescriptionValid("قصير")).toBe(false);
    expect(isCaseDescriptionValid("المقدم وصل متأخر جدا")).toBe(true);
  });
});

describe("walletCheckoutSplit", () => {
  it("spends the wallet first and charges the card for the rest", () => {
    expect(walletCheckoutSplit(300, 120)).toEqual({ walletPart: 120, cardPart: 180, walletOnly: false });
  });
  it("covers the whole total when the wallet is enough", () => {
    expect(walletCheckoutSplit(150, 400)).toEqual({ walletPart: 150, cardPart: 0, walletOnly: true });
  });
  it("is card only without balance and safe on bad input", () => {
    expect(walletCheckoutSplit(200, 0)).toEqual({ walletPart: 0, cardPart: 200, walletOnly: false });
    expect(walletCheckoutSplit(null, -5)).toEqual({ walletPart: 0, cardPart: 0, walletOnly: false });
  });
});

describe("cancellation policy line", () => {
  const fmt = (n: number) => `${n} ج.م`;
  it("formats a fixed fee with free hours", () => {
    const p = normalizeCancellationPolicy({ fee_mode: "fixed", fee_value: 50, free_cancel_hours: 1 });
    expect(cancellationPolicyLine(p, fmt)).toEqual({
      key: "bookFlow.policyFreeUntil",
      params: { hours: 1, fee: "50 ج.م" },
    });
  });
  it("formats a percent fee and caps it at 100", () => {
    const p = normalizeCancellationPolicy({ fee_mode: "percent", fee_value: 150, free_cancel_hours: 4 });
    expect(cancellationPolicyLine(p, fmt)?.params.fee).toBe("100%");
  });
  it("says free when there is no fee and handles no free window", () => {
    expect(cancellationPolicyLine(normalizeCancellationPolicy({ fee_value: 0 }), fmt)?.key).toBe(
      "bookFlow.policyFree",
    );
    const always = normalizeCancellationPolicy({ fee_mode: "fixed", fee_value: 20, free_cancel_hours: 0 });
    expect(cancellationPolicyLine(always, fmt)?.key).toBe("bookFlow.policyFeeAlways");
    expect(cancellationPolicyLine(null, fmt)).toBeNull();
  });
});
