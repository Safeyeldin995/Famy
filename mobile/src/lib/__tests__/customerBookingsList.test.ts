import { describe, expect, it } from "vitest";
import {
  customerBookingListActionKey,
  customerBookingListNeedsPayNow,
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
});