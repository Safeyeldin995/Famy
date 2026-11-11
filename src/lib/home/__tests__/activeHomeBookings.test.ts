import { describe, expect, it } from "vitest";
import {
  CUSTOMER_HOME_ACTIVE_STATUSES,
  customerHomeActiveBookingCtaKey,
  customerHomeActiveBookingNeedsAction,
  customerHomeActiveBookings,
  homeActiveBookingStatusKey,
  pickSoonestCustomerHomeActiveBooking,
} from "../activeHomeBookings";

describe("activeHomeBookings", () => {
  it("maps every active home status to a customerHome status line key", () => {
    for (const status of CUSTOMER_HOME_ACTIVE_STATUSES) {
      expect(homeActiveBookingStatusKey(status)).toBe(`customerHome.activeStatus.${status}`);
    }
    expect(homeActiveBookingStatusKey("completed")).toBeNull();
    expect(homeActiveBookingStatusKey("disputed")).toBeNull();
  });

  it("picks the soonest active booking by start time", () => {
    const bookings = [
      { id: "b", status: "confirmed", start_at: "2026-06-02T10:00:00Z" },
      { id: "a", status: "on_the_way", start_at: "2026-06-01T10:00:00Z" },
      { id: "c", status: "completed", start_at: "2026-06-01T08:00:00Z" },
    ];
    expect(customerHomeActiveBookings(bookings).map((b) => b.id)).toEqual(["a", "b"]);
    expect(pickSoonestCustomerHomeActiveBooking(bookings)?.id).toBe("a");
  });

  it("flags arrived and completion_requested for customer action CTAs", () => {
    expect(customerHomeActiveBookingNeedsAction("arrived")).toBe(true);
    expect(customerHomeActiveBookingNeedsAction("completion_requested")).toBe(true);
    expect(customerHomeActiveBookingNeedsAction("confirmed")).toBe(false);
    expect(customerHomeActiveBookingCtaKey("arrived")).toBe("bookingDetail.confirmArrival");
    expect(customerHomeActiveBookingCtaKey("completion_requested")).toBe(
      "bookingDetail.confirmCompletion",
    );
    expect(customerHomeActiveBookingCtaKey("pending")).toBe("customerHome.openBooking");
  });
});
