import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n", () => ({ currentLang: () => "ar" }));
import {
  bookingCode,
  canCancelBooking,
  canReviewTransfer,
  caseAge,
  matchesBooking,
  mergeCases,
  operationDate,
} from "../operations";
describe("admin operational triage", () => {
  it("only offers guarded cancellation for pending and confirmed", () => {
    expect(canCancelBooking("pending")).toBe(true);
    expect(canCancelBooking("confirmed")).toBe(true);
    for (const status of [
      "completed",
      "disputed",
      "no_show",
      "cancelled",
      "in_progress",
      "completion_requested",
    ])
      expect(canCancelBooking(status)).toBe(false);
  });
  it("never offers review of captured/historic, online or cash payments", () => {
    expect(
      canReviewTransfer({ status: "pending_review", payment_method_type: "manual_transfer" }),
    ).toBe(true);
    expect(canReviewTransfer({ status: "pending_review", method: "instapay" })).toBe(true);
    for (const status of ["captured", "failed", "refunded", "rejected", "pending"])
      expect(canReviewTransfer({ status, payment_method_type: "manual_transfer" })).toBe(false);
    for (const payment_method_type of ["online", "cash"])
      expect(
        canReviewTransfer({ status: "pending_review", method: "instapay", payment_method_type }),
      ).toBe(false);
  });
  it("supports short code and either party's name", () => {
    const b = {
      id: "a1b2c3-1234",
      customer: { full_name: "سارة" },
      provider: { profile: { full_name: "منى" } },
    };
    expect(bookingCode(b.id)).toBe("#A1B2C3");
    for (const term of ["#a1b2c3", "سارة", "منى"]) expect(matchesBooking(b, term)).toBe(true);
    expect(matchesBooking(b, "other")).toBe(false);
  });
  it("combines all case types, active oldest first, closed last", () => {
    const rows = mergeCases(
      [{ id: "s", status: "closed", created_at: "2026-01-01" }],
      [{ id: "d", status: "open", created_at: "2026-01-02" }],
      [{ id: "n", status: "info_requested", created_at: "2026-01-03" }],
    );
    expect(rows.map((r) => r.kind)).toEqual(["disputes", "no_shows", "support"]);
  });
  it("formats Arabic dates and relative age with Latin digits", () => {
    expect(operationDate("2026-10-13T12:00:00Z", "ar")).not.toMatch(/[٠-٩]/);
    expect(caseAge("2026-10-13T10:00:00Z", "ar", Date.parse("2026-10-13T12:00:00Z"))).toContain(
      "ساعتين",
    );
    expect(operationDate(null, "ar")).toBe("—");
  });
});
