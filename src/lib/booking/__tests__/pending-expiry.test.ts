import { describe, expect, it } from "vitest";
import {
  creationMinHours,
  DEFAULT_BOOKING_EXPIRY_SETTINGS,
  isExpiredCapturedPayment,
  isProviderNoResponseCancellation,
  parseBookingExpirySettings,
  pendingResponseDeadline,
  respondWithinParts,
} from "@/lib/booking/pending-expiry";

describe("pending expiry helpers", () => {
  it("parses booking_expiry settings with defaults", () => {
    expect(parseBookingExpirySettings(null)).toEqual(DEFAULT_BOOKING_EXPIRY_SETTINGS);
    expect(parseBookingExpirySettings({ pending_ttl_hours: 6, min_hours_before_start: 3 })).toEqual(
      {
        pending_ttl_hours: 6,
        min_hours_before_start: 3,
      },
    );
  });

  it("detects provider_no_response cancellations", () => {
    expect(
      isProviderNoResponseCancellation({
        status: "cancelled",
        cancellation_reason: "provider_no_response",
      }),
    ).toBe(true);
    expect(
      isProviderNoResponseCancellation({
        status: "cancelled",
        cancellation_reason: "customer_other",
      }),
    ).toBe(false);
    expect(
      isProviderNoResponseCancellation({
        status: "pending",
        cancellation_reason: "provider_no_response",
      }),
    ).toBe(false);
  });

  it("flags captured payments that need admin review", () => {
    expect(isExpiredCapturedPayment({ status: "captured", needs_admin_review: true })).toBe(true);
    expect(
      isExpiredCapturedPayment({
        status: "captured",
        metadata: { admin_review_reason: "expired_pending_captured" },
      }),
    ).toBe(true);
    expect(isExpiredCapturedPayment({ status: "pending", needs_admin_review: false })).toBe(false);
  });

  it("uses the earlier of 12h TTL and 2h before start", () => {
    const created = new Date("2026-10-01T00:00:00.000Z");
    const startSoon = new Date("2026-10-01T06:00:00.000Z");
    const startLate = new Date("2026-10-02T00:00:00.000Z");
    expect(pendingResponseDeadline(created, startSoon).toISOString()).toBe(
      "2026-10-01T04:00:00.000Z",
    );
    expect(pendingResponseDeadline(created, startLate).toISOString()).toBe(
      "2026-10-01T12:00:00.000Z",
    );
  });

  it("keeps the stricter creation window", () => {
    expect(creationMinHours(0)).toBe(2);
    expect(creationMinHours(4)).toBe(4);
  });

  it("formats remaining response time", () => {
    const now = new Date("2026-10-01T12:00:00.000Z");
    expect(respondWithinParts(new Date("2026-10-01T12:20:00.000Z"), now)).toEqual({
      kind: "minutes",
      count: 20,
    });
    expect(respondWithinParts(new Date("2026-10-01T15:00:00.000Z"), now)).toEqual({
      kind: "hours",
      count: 3,
    });
    expect(respondWithinParts(new Date("2026-10-01T11:00:00.000Z"), now)).toEqual({
      kind: "overdue",
    });
  });
});
