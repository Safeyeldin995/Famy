import { expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { workingHoursSummary } from "../workingHoursSummary";
const rule = (weekday: number, start_time = "09:00:00", end_time = "17:00:00") => ({
  weekday,
  start_time,
  end_time,
});
it("compresses consecutive equal days in either language without changing input", () => {
  const rules = [4, 2, 0, 1, 3].map((day) => rule(day));
  expect(workingHoursSummary(rules, i18n.getFixedT("en"))).toEqual([
    "Sunday to Thursday · 9 AM to 5 PM",
  ]);
  expect(workingHoursSummary(rules, i18n.getFixedT("ar"))).toEqual([
    "من الأحد لحد الخميس · 9 ص لـ 5 م",
  ]);
  expect(rules.map((row) => row.weekday)).toEqual([4, 2, 0, 1, 3]);
});
it("keeps nonconsecutive days and different hours in separate ranges", () => {
  expect(
    workingHoursSummary(
      [rule(0), rule(1), rule(3), rule(4, "10:30", "18:00"), rule(5, "10:30", "18:00")],
      i18n.getFixedT("en"),
    ),
  ).toEqual([
    "Sunday to Monday · 9 AM to 5 PM",
    "Wednesday · 9 AM to 5 PM",
    "Thursday to Friday · 10:30 AM to 6 PM",
  ]);
});
it("keeps split intervals and only merges days whose full schedules match", () => {
  expect(
    workingHoursSummary(
      [rule(0, "09:00", "12:00"), rule(0, "14:00", "17:00"), rule(1, "09:00", "12:00")],
      i18n.getFixedT("en"),
    ),
  ).toEqual(["Sunday · 9 AM to 12 PM · 2 PM to 5 PM", "Monday · 9 AM to 12 PM"]);
});
it("renders overnight 24:00 as midnight and handles no schedule", () => {
  expect(workingHoursSummary([rule(5, "18:00", "24:00")], i18n.getFixedT("ar"))).toEqual([
    "الجمعة · 6 م لـ 12 بالليل",
  ]);
  expect(workingHoursSummary([rule(5, "18:00", "24:00")], i18n.getFixedT("en"))).toEqual([
    "Friday · 6 PM to 12 midnight",
  ]);
  expect(workingHoursSummary([], i18n.getFixedT("en"))).toEqual([]);
});
