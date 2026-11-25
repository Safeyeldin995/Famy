import { describe, expect, it } from "vitest";
import {
  customerBookingListActionKey,
  customerBookingListNeedsPayNow,
  sortUpcomingCustomerBookings,
} from "../customerBookingsList";

describe("customerBookingsList", () => {
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