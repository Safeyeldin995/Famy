import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import {
  bookingCountdownLabel,
  bookingStatusStep,
  notificationRowNavigation,
  shortBookingCode,
} from "../workScreenPresentation";

describe("short booking codes", () => {
  it("keeps a stable six-character suffix without the preview prefix", () => {
    expect(shortBookingCode("12345678-abcd-4000-8000-000000a1b2c3")).toBe("A1B2C3");
    expect(shortBookingCode("booking-pro-pending-1")).toBe("NDING1");
    expect(shortBookingCode("booking-pro-pending-2")).not.toBe(
      shortBookingCode("booking-pro-pending-1"),
    );
    expect(shortBookingCode("booking-pro-pending-1")).not.toContain("BOOKING");
  });
});

describe("response countdown labels", () => {
  const created = "2026-09-01T10:00:00Z";
  const start = "2026-09-02T10:00:00Z";
  const t = i18n.getFixedT("ar");
  it("uses the configured TTL and Latin digits with full Arabic units", () => {
    expect(
      bookingCountdownLabel(
        created,
        start,
        { pending_ttl_hours: 2, min_hours_before_start: 2 },
        new Date(created),
        "ar",
        t,
      ),
    ).toBe("رد خلال 2 ساعة");
  });
  it("uses the earlier start cutoff without changing the expiry rules", () => {
    expect(
      bookingCountdownLabel(created, "2026-09-01T12:30:00Z", undefined, new Date(created), "ar", t),
    ).toBe("رد خلال 30 دقيقة");
  });
  it("reports overdue at the deadline and avoids invalid date labels", () => {
    expect(
      bookingCountdownLabel(created, start, undefined, new Date("2026-09-01T22:00:00Z"), "ar", t),
    ).toBe("مهلة الرد انتهت");
    expect(
      bookingCountdownLabel("invalid", "invalid", undefined, new Date(created), "ar", t),
    ).toBeNull();
  });
});

describe("status card steps", () => {
  it.each([
    ["pending", "confirmed"],
    ["confirmed", "on_the_way"],
    ["on_the_way", "arrived"],
    ["arrived", "arrival_confirmed"],
    ["arrival_confirmed", "in_progress"],
    ["in_progress", "completion_requested"],
    ["completion_requested", "completed"],
    ["completed", null],
    ["cancelled", null],
    ["disputed", null],
    ["no_show", null],
    ["unknown", null],
  ])("maps %s to the next displayed step %s without changing status", (status, next) => {
    expect(bookingStatusStep(status)).toMatchObject({ current: status, next });
  });
});

describe("notification row navigation", () => {
  it("marks an unread row and resolves its existing deep link", () => {
    expect(
      notificationRowNavigation(
        { id: "n1", deep_link: "/pro/booking/abc" },
        (path) => `/preview${path}`,
      ),
    ).toEqual({ markReadId: "n1", to: "/preview/pro/booking/abc" });
  });
  it("still opens an already-read row without marking it again", () => {
    expect(
      notificationRowNavigation(
        { id: "n1", read_at: "2026-09-01", deep_link: "/pro/bookings" },
        (path) => path,
      ),
    ).toEqual({ markReadId: null, to: "/pro/bookings" });
  });
  it("marks a row without a deep link without inventing a destination", () => {
    expect(notificationRowNavigation({ id: "n1", deep_link: null }, (path) => path)).toEqual({
      markReadId: "n1",
      to: null,
    });
  });
});
