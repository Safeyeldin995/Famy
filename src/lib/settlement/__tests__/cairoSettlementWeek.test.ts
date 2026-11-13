import { afterEach, describe, expect, it } from "vitest";
import {
  currentWeekLedgerRange,
  defaultFinanceRangeFromPeriod,
  financeRangeForDays,
  financeRangeForPreset,
  formatInstantForDatetimeLocal,
} from "../cairoSettlementWeek";

describe("formatInstantForDatetimeLocal", () => {
  const previousTz = process.env.TZ;

  afterEach(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  it("uses local calendar components instead of slicing a UTC ISO string", () => {
    process.env.TZ = "Africa/Cairo";
    const iso = "2026-11-13T12:00:00.000Z";
    expect(formatInstantForDatetimeLocal(iso)).toBe("2026-11-13T14:00");
    expect(formatInstantForDatetimeLocal(iso)).not.toBe(iso.slice(0, 16));
  });
});

describe("defaultFinanceRangeFromPeriod", () => {
  it("starts at period_end (current week boundary), not period_start", () => {
    const period = {
      period_start: "2026-11-08T08:00:00.000Z",
      period_end: "2026-11-15T08:00:00.000Z",
      next_settlement_at: "2026-11-22T08:00:00.000Z",
    };
    const range = defaultFinanceRangeFromPeriod(period);
    expect(range.from).toBe(formatInstantForDatetimeLocal(period.period_end));
    expect(range.from).not.toBe(formatInstantForDatetimeLocal(period.period_start));
  });
});

describe("currentWeekLedgerRange", () => {
  it("starts at period_end and ends at now before the next settlement", () => {
    const period = {
      period_start: "2026-11-08T08:00:00.000Z",
      period_end: "2026-11-15T08:00:00.000Z",
      next_settlement_at: "2026-11-22T08:00:00.000Z",
    };
    const now = new Date("2026-11-13T12:00:00.000Z");
    expect(currentWeekLedgerRange(period, now)).toEqual({
      from: period.period_end,
      to: now.toISOString(),
    });
    expect(currentWeekLedgerRange(period, now).from).not.toBe(period.period_start);
  });

  it("caps the upper bound at next_settlement_at when now is past it", () => {
    const period = {
      period_start: "2026-11-08T08:00:00.000Z",
      period_end: "2026-11-15T08:00:00.000Z",
      next_settlement_at: "2026-11-22T08:00:00.000Z",
    };
    const now = new Date("2026-11-25T12:00:00.000Z");
    expect(currentWeekLedgerRange(period, now)).toEqual({
      from: period.period_end,
      to: period.next_settlement_at,
    });
  });
});

describe("finance period presets", () => {
  const period = {
    period_start: "2026-11-01T08:00:00.000Z",
    period_end: "2026-11-08T08:00:00.000Z",
    next_settlement_at: "2026-11-15T08:00:00.000Z",
  };
  const now = new Date("2026-11-13T12:00:00.000Z");

  it("this week runs from the last close until now", () => {
    expect(financeRangeForPreset("thisWeek", period, now)).toEqual({
      from: period.period_end,
      to: now.toISOString(),
    });
  });

  it("last week is the closed settlement week", () => {
    expect(financeRangeForPreset("lastWeek", period, now)).toEqual({
      from: period.period_start,
      to: period.period_end,
    });
  });

  it("custom days are Cairo days, include the whole end day and reject reversed ranges", () => {
    const r = financeRangeForDays("2026-11-01", "2026-11-01");
    expect(r).toEqual({ from: "2026-10-31T22:00:00.000Z", to: "2026-11-01T22:00:00.000Z" });
    // Summer time in Cairo (UTC+3).
    expect(financeRangeForDays("2026-07-01", "2026-07-01")).toEqual({
      from: "2026-06-30T21:00:00.000Z",
      to: "2026-07-01T21:00:00.000Z",
    });
    expect(financeRangeForDays("2026-11-05", "2026-11-01")).toBeNull();
    expect(financeRangeForDays("", "2026-11-01")).toBeNull();
  });
});

describe("finance presets use Cairo calendar and never invert", () => {
  const period = {
    period_start: "2026-11-01T08:00:00.000Z",
    period_end: "2026-11-08T08:00:00.000Z",
    next_settlement_at: "2026-11-15T08:00:00.000Z",
  };

  it("this month starts at Cairo midnight on the 1st", () => {
    const r = financeRangeForPreset("thisMonth", period, new Date("2026-11-13T12:00:00.000Z"));
    expect(r.from).toBe("2026-10-31T22:00:00.000Z");
  });

  it("this week never returns from after to when the anchor predates a new close", () => {
    const r = financeRangeForPreset("thisWeek", period, new Date("2026-11-07T12:00:00.000Z"));
    expect(Date.parse(r.to)).toBeGreaterThan(Date.parse(r.from));
  });
});
