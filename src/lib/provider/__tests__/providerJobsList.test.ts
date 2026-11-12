import { describe, expect, it } from "vitest";
import {
  cairoBookingDayKey,
  defaultProviderJobsTab,
  groupProviderUpcomingBookings,
  providerUpcomingDayLabel,
} from "../providerJobsList";

describe("providerJobsList", () => {
  const now = new Date("2026-11-12T10:00:00+02:00");
  const todayKey = cairoBookingDayKey(now);

  it("groups upcoming jobs into now, today, and future days sorted by time", () => {
    const bookings = [
      {
        id: "later",
        status: "confirmed",
        start_at: new Date("2026-11-14T14:00:00+02:00").toISOString(),
      },
      {
        id: "now",
        status: "on_the_way",
        start_at: new Date("2026-11-12T11:00:00+02:00").toISOString(),
      },
      {
        id: "today",
        status: "confirmed",
        start_at: new Date("2026-11-12T16:00:00+02:00").toISOString(),
      },
      {
        id: "today-early",
        status: "confirmed",
        start_at: new Date("2026-11-12T12:00:00+02:00").toISOString(),
      },
    ];
    const sections = groupProviderUpcomingBookings(bookings, now);
    expect(sections.map((s) => s.kind)).toEqual(["now", "today", "day"]);
    expect(sections[0].kind === "now" && sections[0].bookings.map((b) => b.id)).toEqual(["now"]);
    expect(sections[1].kind === "today" && sections[1].bookings.map((b) => b.id)).toEqual([
      "today-early",
      "today",
    ]);
    expect(sections[2].kind === "day" && sections[2].dayKey).toBe("2026-11-14");
  });

  it("opens on requests only when pending exist and no work today", () => {
    const upcoming = [
      {
        id: "future",
        status: "confirmed",
        start_at: new Date("2026-11-15T10:00:00+02:00").toISOString(),
      },
    ];
    expect(defaultProviderJobsTab(2, upcoming, now)).toBe("requests");
    expect(
      defaultProviderJobsTab(2, [{ id: "t", status: "confirmed", start_at: now.toISOString() }], now),
    ).toBe("upcoming");
    expect(
      defaultProviderJobsTab(2, [{ id: "t", status: "on_the_way", start_at: now.toISOString() }], now),
    ).toBe("upcoming");
    expect(defaultProviderJobsTab(0, upcoming, now)).toBe("upcoming");
  });

  it("formats tomorrow and weekday labels", () => {
    const tomorrowKey = "2026-11-13";
    expect(providerUpcomingDayLabel(tomorrowKey, "ar", now)).toBe("بكرة");
    expect(providerUpcomingDayLabel(todayKey, "ar", now)).toMatch(/12/);
    expect(providerUpcomingDayLabel("2026-11-14", "ar", now)).toMatch(/14.*نوفمبر/);
  });
});
