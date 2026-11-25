import { describe, expect, it } from "vitest";
import { cairoWeekday, customerDayKey } from "../customerDates";

// Slot vacation/exception matching must use Africa/Cairo calendar days, not UTC ISO dates.

describe("slot calendar day (Africa/Cairo)", () => {
  it("keeps Friday evening Cairo on the Friday calendar key when run in UTC", () => {
    const fridayEveningCairo = new Date("2026-11-27T20:00:00+02:00");
    expect(customerDayKey(fridayEveningCairo)).toBe("2026-11-27");
    expect(cairoWeekday(fridayEveningCairo)).toBe(5);
  });

  it("maps Cairo midnight that still sits on the prior UTC day", () => {
    const cairoMidnight = new Date("2026-11-26T22:00:00.000Z");
    expect(customerDayKey(cairoMidnight)).toBe("2026-11-27");
    expect(cairoWeekday(cairoMidnight)).toBe(5);
  });

  it("matches vacation edge dates on inclusive bounds", () => {
    const vacationStart = customerDayKey(new Date("2026-12-01T10:00:00+02:00"));
    const vacationEnd = customerDayKey(new Date("2026-12-03T10:00:00+02:00"));
    const pickedDay = customerDayKey(new Date("2026-12-03T23:30:00+02:00"));
    expect(pickedDay >= vacationStart && pickedDay <= vacationEnd).toBe(true);
    const dayBefore = customerDayKey(new Date("2026-11-30T23:30:00+02:00"));
    expect(dayBefore >= vacationStart && dayBefore <= vacationEnd).toBe(false);
  });
});