import { describe, expect, it } from "vitest";
import { pickBookingPaymentRow } from "../bookingPaymentVisibility";

const row = (id: string, status: string, created_at: string, metadata: unknown = {}) => ({
  id,
  status,
  created_at,
  metadata,
});

describe("pickBookingPaymentRow", () => {
  it("returns null without rows", () => {
    expect(pickBookingPaymentRow([])).toBeNull();
    expect(pickBookingPaymentRow(null)).toBeNull();
  });

  it("shows the latest attempt when nothing funds the booking", () => {
    const picked = pickBookingPaymentRow([
      row("a", "rejected", "2026-11-25T10:00:00Z"),
      row("b", "pending", "2026-11-25T10:05:00Z"),
    ]);
    expect(picked?.id).toBe("b");
  });

  it("prefers an older captured attempt over a newer pending retry", () => {
    const picked = pickBookingPaymentRow([
      row("b", "pending", "2026-11-25T10:05:00Z"),
      row("a", "captured", "2026-11-25T10:00:00Z"),
    ]);
    expect(picked?.id).toBe("a");
  });

  it("skips a capture excluded from booking funding", () => {
    const picked = pickBookingPaymentRow([
      row("a", "captured", "2026-11-25T10:10:00Z", { excluded_from_booking_funding: true }),
      row("b", "captured", "2026-11-25T10:05:00Z"),
    ]);
    expect(picked?.id).toBe("b");
  });

  it("treats partially refunded as funding", () => {
    const picked = pickBookingPaymentRow([
      row("c", "pending", "2026-11-25T11:00:00Z"),
      row("a", "partially_refunded", "2026-11-25T10:00:00Z"),
    ]);
    expect(picked?.id).toBe("a");
  });
});
