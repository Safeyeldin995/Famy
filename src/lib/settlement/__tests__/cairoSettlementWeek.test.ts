import { afterEach, describe, expect, it } from "vitest";
import {
  currentWeekLedgerRange,
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
