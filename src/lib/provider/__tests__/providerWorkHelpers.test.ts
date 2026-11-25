import { describe, expect, it } from "vitest";
import {
  bookingRecordedInWallet,
  dashboardUpcomingBookings,
  directionsUrl,
  providerMoneyBreakdown,
  requestCountdown,
  requestCountdownLabel,
} from "../providerWorkHelpers";

const settings = { pending_ttl_hours: 12, min_hours_before_start: 2, auto_complete_hours: 6 };
const t = (key: string, o?: Record<string, unknown>) => `${key}${o ? JSON.stringify(o) : ""}`;

describe("dashboardUpcomingBookings (Cairo day)", () => {
  // 2026-11-25 23:30 Cairo (UTC+2) = 21:30 UTC.
  const now = new Date("2026-11-25T21:30:00Z");

  it("keeps a job that started yesterday and is still in progress", () => {
    const rows = [
      { id: "a", status: "in_progress", start_at: "2026-11-24T18:00:00Z" },
      { id: "b", status: "confirmed", start_at: "2026-11-24T18:00:00Z" },
    ];
    expect(dashboardUpcomingBookings(rows, now).map((r) => r.id)).toEqual(["a"]);
  });

  it("uses the Cairo calendar day, not UTC: a 00:30 Cairo job tomorrow is upcoming, earlier today too", () => {
    const rows = [
      // 25 Nov 21:00 Cairo (earlier today) → still today in Cairo.
      { id: "today", status: "confirmed", start_at: "2026-11-25T19:00:00Z" },
      // 25 Nov 00:30 Cairo = 24 Nov 22:30 UTC: same Cairo day as now.
      { id: "earlyToday", status: "confirmed", start_at: "2026-11-24T22:30:00Z" },
      // 24 Nov 23:00 Cairo: yesterday.
      { id: "yesterday", status: "confirmed", start_at: "2026-11-24T21:00:00Z" },
    ];
    expect(dashboardUpcomingBookings(rows, now).map((r) => r.id).sort()).toEqual([
      "earlyToday",
      "today",
    ]);
  });

  it("puts in-flight jobs first, then by start time, and ignores finished ones", () => {
    const rows = [
      { id: "later", status: "confirmed", start_at: "2026-11-27T10:00:00Z" },
      { id: "soon", status: "confirmed", start_at: "2026-11-26T08:00:00Z" },
      { id: "onTheWay", status: "on_the_way", start_at: "2026-11-26T09:00:00Z" },
      { id: "done", status: "completed", start_at: "2026-11-26T07:00:00Z" },
      { id: "pending", status: "pending", start_at: "2026-11-26T07:00:00Z" },
    ];
    expect(dashboardUpcomingBookings(rows, now).map((r) => r.id)).toEqual([
      "onTheWay",
      "soon",
      "later",
    ]);
  });
});

describe("requestCountdown", () => {
  const created = "2026-11-25T08:00:00Z";
  const start = "2026-11-27T08:00:00Z"; // far away: the 12h TTL wins → deadline 20:00Z

  it("shows hours and minutes left", () => {
    const c = requestCountdown(created, start, settings, new Date("2026-11-25T17:46:00Z"));
    expect(c).toEqual({ kind: "left", hours: 2, minutes: 14, totalMinutes: 134, urgent: false });
    expect(requestCountdownLabel(c, t)).toBe(
      'pro.bookings.respondCountdownHoursMinutes{"hours":2,"minutes":14}',
    );
  });

  it("turns urgent under 30 minutes and never shows zero", () => {
    const c = requestCountdown(created, start, settings, new Date("2026-11-25T19:59:30Z"));
    expect(c).toMatchObject({ kind: "left", hours: 0, minutes: 1, urgent: true });
    expect(requestCountdownLabel(c, t)).toBe('pro.bookings.respondCountdownMinutes{"minutes":1}');
  });

  it("uses the start-time deadline when it comes first", () => {
    // Start in 5h → deadline = start − 2h = 3h from now.
    const now = new Date("2026-11-25T09:00:00Z");
    const c = requestCountdown("2026-11-25T08:30:00Z", "2026-11-25T14:00:00Z", settings, now);
    expect(c).toMatchObject({ kind: "left", hours: 3, minutes: 0 });
  });

  it("is overdue after the deadline", () => {
    const c = requestCountdown(created, start, settings, new Date("2026-11-25T20:00:01Z"));
    expect(c).toEqual({ kind: "overdue" });
    expect(requestCountdownLabel(c, t)).toBe("pro.bookings.respondOverdue");
  });
});

describe("providerMoneyBreakdown", () => {
  it("uses the snapshotted commission and net", () => {
    expect(
      providerMoneyBreakdown({
        price_subtotal: 300,
        price_extras_total: 50,
        price_travel_fee: 20,
        price_provider_net: 314.5,
        price_commission_amount: 55.5,
      }),
    ).toEqual({ bookingValue: 370, commission: 55.5, net: 314.5 });
  });

  it("derives the commission from value − net when only the net was snapshotted", () => {
    expect(
      providerMoneyBreakdown({ price_subtotal: 200, price_provider_net: 170 }),
    ).toEqual({ bookingValue: 200, commission: 30, net: 170 });
  });

  it("returns null when nothing was snapshotted (never recompute old commissions)", () => {
    expect(providerMoneyBreakdown({ price_subtotal: 200 })).toBeNull();
  });
});

describe("bookingRecordedInWallet", () => {
  it("matches the booking's online share or cash platform share only", () => {
    const ledger = [
      { booking_id: "b1", kind: "online_provider_share" },
      { booking_id: "b2", kind: "payout_sent" },
    ];
    expect(bookingRecordedInWallet("b1", ledger)).toBe(true);
    expect(bookingRecordedInWallet("b2", ledger)).toBe(false);
    expect(bookingRecordedInWallet("b3", undefined)).toBe(false);
  });
});

describe("directionsUrl", () => {
  it("builds a Google Maps directions link", () => {
    expect(directionsUrl(30.0444, 31.2357)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=30.0444,31.2357",
    );
  });

  it("rejects missing or invalid coordinates", () => {
    expect(directionsUrl(null, 31)).toBeNull();
    expect(directionsUrl(0, 0)).toBeNull();
    expect(directionsUrl(120, 31)).toBeNull();
    expect(directionsUrl("x", 31)).toBeNull();
  });
});
