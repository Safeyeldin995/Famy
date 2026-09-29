import { describe, expect, it } from "vitest";
import { ageInWholeMonthsUtc } from "@/lib/booking/childAgeMonths";
import {
  addUtcMonthsAtHour,
  dateOfBirthForWholeMonthsUtc,
  FIXTURE_MAX_ADVANCE_DAYS,
  isWithinAdvanceWindow,
  planCrossBandRescheduleUtc,
  PRESCHOOL_MIN_MONTHS,
  TODDLER_MAX_MONTHS,
} from "./babysittingCrossBandWindow";

describe("cross-band reschedule window", () => {
  it("keeps a 35-month child in-window at +1 month and out of window at +2 months", () => {
    const now = new Date("2026-09-29T07:21:00Z");
    const originalStart = new Date("2026-10-08T10:00:00Z");
    const dateOfBirth = dateOfBirthForWholeMonthsUtc(originalStart, TODDLER_MAX_MONTHS);
    const plusOne = addUtcMonthsAtHour(originalStart, 1);
    const plusTwo = addUtcMonthsAtHour(originalStart, 2);

    expect(ageInWholeMonthsUtc(dateOfBirth, originalStart)).toBe(TODDLER_MAX_MONTHS);
    expect(
      ageInWholeMonthsUtc(dateOfBirth, new Date(originalStart.getTime() + 24 * 60 * 60 * 1000)),
    ).toBe(TODDLER_MAX_MONTHS);
    expect(ageInWholeMonthsUtc(dateOfBirth, plusOne)).toBe(PRESCHOOL_MIN_MONTHS);
    expect(isWithinAdvanceWindow(plusOne, now)).toBe(true);
    expect(isWithinAdvanceWindow(plusTwo, now)).toBe(false);
    expect((plusTwo.getTime() - now.getTime()) / 86_400_000).toBeGreaterThan(
      FIXTURE_MAX_ADVANCE_DAYS,
    );

    const planned = planCrossBandRescheduleUtc({ originalStart, dateOfBirth, now });
    expect(ageInWholeMonthsUtc(dateOfBirth, planned)).toBe(PRESCHOOL_MIN_MONTHS);
    expect(isWithinAdvanceWindow(planned, now)).toBe(true);
    expect(planned.toISOString()).toBe(plusOne.toISOString());
  });

  it("still crosses 35→36 months on a month-end original start", () => {
    const now = new Date("2026-01-22T07:00:00Z");
    const originalStart = new Date("2026-01-31T10:00:00Z");
    const dateOfBirth = dateOfBirthForWholeMonthsUtc(originalStart, TODDLER_MAX_MONTHS);
    const planned = planCrossBandRescheduleUtc({ originalStart, dateOfBirth, now });

    expect(ageInWholeMonthsUtc(dateOfBirth, originalStart)).toBe(TODDLER_MAX_MONTHS);
    expect(ageInWholeMonthsUtc(dateOfBirth, planned)).toBe(PRESCHOOL_MIN_MONTHS);
    expect(isWithinAdvanceWindow(planned, now)).toBe(true);
  });

  it("throws instead of returning a date past max_advance_days", () => {
    const now = new Date("2026-09-29T07:21:00Z");
    const originalStart = new Date("2026-11-18T10:00:00Z");
    const dateOfBirth = dateOfBirthForWholeMonthsUtc(originalStart, TODDLER_MAX_MONTHS);

    expect(() => planCrossBandRescheduleUtc({ originalStart, dateOfBirth, now })).toThrow(
      /max_advance_days|exactly 36 months/i,
    );
  });
});
