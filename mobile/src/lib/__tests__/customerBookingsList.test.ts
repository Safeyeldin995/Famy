import { describe, expect, it } from "vitest";
import {
  customerBookingListActionKey,
  customerBookingListNeedsPayNow,
  latestCompletedBookingWithoutReview,
  sortUpcomingCustomerBookings,
} from "../customerBookingsList";

describe("customerBookingsList", () => {
  it("does not pin pay now when an older pending attempt was superseded by capture", () => {
    const booking = {
      id: "b2",
      status: "confirmed",
      start_at: "2026-12-01T10:00:00Z",
      price_total: 500,
      payments: [
        {
          status: "rejected",
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          status: "captured",
          payment_method_type: "card",
          created_at: "2026-01-01T11:00:00Z",
        },
        {
          status: "pending",
          created_at: "2026-01-01T09:00:00Z",
        },
      ],
    };
    expect(customerBookingListNeedsPayNow(booking)).toBe(false);
    expect(customerBookingListActionKey(booking)).toBe(null);
  });

  it("does not ask to pay again when a newer attempt is pending after a capture", () => {
    expect(
      customerBookingListNeedsPayNow({
        id: "b3",
        status: "confirmed",
        start_at: "2026-12-01T10:00:00Z",
        price_total: 500,
        payments: [
          { status: "captured", payment_method_type: "online", created_at: "2026-01-01T09:00:00Z" },
          { status: "pending", payment_method_type: "online", created_at: "2026-01-01T12:00:00Z" },
        ],
      }),
    ).toBe(false);
  });

  it("never asks to pay a cash booking in the app", () => {
    expect(
      customerBookingListNeedsPayNow({
        id: "b4",
        status: "confirmed",
        start_at: "2026-12-01T10:00:00Z",
        price_total: 500,
        payments: [{ status: "pending", payment_method_type: "cash", created_at: "2026-01-01T09:00:00Z" }],
      }),
    ).toBe(false);
  });

  it("flags pay now when confirmed without captured payment", () => {
    const booking = {
      id: "b1",
      status: "confirmed",
      start_at: "2026-12-01T10:00:00Z",
      price_total: 500,
      payments: [{ status: "pending" }],
    };
    expect(customerBookingListNeedsPayNow(booking)).toBe(true);
    expect(customerBookingListActionKey(booking)).toBe("bookings.payNow");
  });

  it("pins action-needed bookings ahead of other upcoming rows", () => {
    const rows = sortUpcomingCustomerBookings([
      {
        id: "late",
        status: "confirmed",
        start_at: "2026-12-10T10:00:00Z",
        price_total: 0,
      },
      {
        id: "arrived",
        status: "arrived",
        start_at: "2026-12-11T10:00:00Z",
        price_total: 0,
      },
    ]);
    expect(rows[0].id).toBe("arrived");
  });

  it("asks for a rating only within 14 days and skips dismissed bookings", () => {
    const now = new Date("2026-12-20T10:00:00Z");
    const recent = { id: "r", status: "completed", start_at: "2026-12-15T08:00:00Z", end_at: "2026-12-15T10:00:00Z" };
    const old = { id: "o", status: "completed", start_at: "2026-11-01T08:00:00Z", end_at: "2026-11-01T10:00:00Z" };
    expect(latestCompletedBookingWithoutReview([old, recent], { now })?.id).toBe("r");
    expect(latestCompletedBookingWithoutReview([old], { now })).toBeNull();
    expect(
      latestCompletedBookingWithoutReview([recent], { now, dismissedIds: new Set(["r"]) }),
    ).toBeNull();
    expect(
      latestCompletedBookingWithoutReview([{ ...recent, hasReview: true }], { now }),
    ).toBeNull();
  });
});
