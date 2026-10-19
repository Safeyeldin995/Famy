import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import ar from "@/lib/i18n/locales/ar";
import en from "@/lib/i18n/locales/en";
import {
  scheduleYears,
  scheduleToday,
  scheduleMonthDays,
  updateScheduleDate,
  validateScheduleRange,
} from "../scheduleDate";

it("offers only the current and following year, including at the year boundary", () => {
  expect(scheduleYears(new Date(2026, 11, 31))).toEqual([2026, 2027]);
  expect(scheduleYears(new Date(2027, 0, 1))).toEqual([2027, 2028]);
});
it("defaults to today's local calendar date", () => {
  expect(scheduleToday(new Date(2026, 10, 3, 23, 59))).toEqual({
    year: "2026",
    month: "11",
    day: "3",
  });
});
it("respects month lengths and clamps a selected day on month/year changes", () => {
  expect(scheduleMonthDays("2026", "11")).toBe(30);
  expect(scheduleMonthDays("2028", "2")).toBe(29);
  expect(scheduleMonthDays("2027", "2")).toBe(28);
  expect(updateScheduleDate({ year: "2026", month: "10", day: "31" }, "month", "11").day).toBe(
    "30",
  );
  expect(updateScheduleDate({ year: "2028", month: "2", day: "29" }, "year", "2029").day).toBe(
    "28",
  );
});
it("rejects past starts and reversed ranges, and allows today and same-day leave", () => {
  const today = new Date(2026, 11, 31, 23, 59);
  expect(validateScheduleRange("2026-12-30", "2027-01-01", today)).toBe("startPast");
  expect(validateScheduleRange("2027-01-02", "2027-01-01", today)).toBe("endBeforeStart");
  expect(validateScheduleRange("2026-12-31", "2026-12-31", today)).toBeNull();
  expect(validateScheduleRange("2026-12-31", "2027-01-01", today)).toBeNull();
  expect(validateScheduleRange(null, "2027-01-01", today)).toBe("invalidDate");
});
it("provides every schedule translation referenced by the sheet in both locales", () => {
  const source = readFileSync("src/components/provider/ScheduleDateSheet.tsx", "utf8");
  const keys = [...source.matchAll(/["'](pro\.schedule\.[\w]+)["']/g)].map((match) => match[1]);
  expect(keys).toContain("pro.schedule.vacationStart");
  expect(keys).toContain("pro.schedule.vacationEnd");
  for (const locale of [ar, en]) {
    for (const key of keys) {
      const value = key
        .split(".")
        .reduce<unknown>((object, part) => (object as Record<string, unknown>)?.[part], locale);
      expect(value, key).toBeTypeOf("string");
      expect(value, key).not.toBe("");
      expect(value, key).not.toBe(key);
    }
  }
});
