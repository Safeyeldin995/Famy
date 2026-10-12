import { expect, it } from "vitest";
import { scheduleDate } from "../scheduleDate";
it("serializes date-only fields without a timezone conversion", () => {
  expect(scheduleDate({ year: "2028", month: "2", day: "29" })).toBe("2028-02-29");
});
it("rejects incomplete and impossible dates", () => {
  expect(scheduleDate({ year: "", month: "2", day: "1" })).toBeNull();
  expect(scheduleDate({ year: "2027", month: "2", day: "29" })).toBeNull();
  expect(scheduleDate({ year: "2027", month: "4", day: "31" })).toBeNull();
});

import { scheduleDateLabel, scheduleTimeChoices, timeChoiceLabel } from "../scheduleDate";
it.each([
  ["09:00", "9 ص", "9 AM"],
  ["09:30", "9:30 ص", "9:30 AM"],
  ["12:00", "12 م", "12 PM"],
  ["17:00", "5 م", "5 PM"],
  ["24:00", "12 بالليل", "midnight"],
  ["09:17", "9:17 ص", "9:17 AM"],
])("labels %s with Latin digits and localized periods", (value, ar, en) => {
  expect(timeChoiceLabel(value, "ar")).toBe(ar);
  expect(timeChoiceLabel(value, "en")).toBe(en);
});
it("offers half-hour boundaries without duplicates and preserves off-grid saved times", () => {
  expect(scheduleTimeChoices("09:00", false)).toHaveLength(48);
  expect(scheduleTimeChoices("24:00", true)).toHaveLength(49);
  expect(scheduleTimeChoices("09:17", false)).toHaveLength(49);
  expect(scheduleTimeChoices("09:17", false)).toContain("09:17");
  expect(scheduleTimeChoices("09:17", true)).toHaveLength(50);
  expect(scheduleTimeChoices("09:17", true).slice(18, 21)).toEqual(["09:00", "09:17", "09:30"]);
  expect(scheduleTimeChoices("09:00", false)).not.toContain("24:00");
});
it("formats vacations and holidays with Latin digits and local calendar names", () => {
  expect(scheduleDateLabel("2026-11-01", "ar")).toBe("1 نوفمبر");
  expect(scheduleDateLabel("2026-11-03", "ar")).toBe("3 نوفمبر");
  expect(scheduleDateLabel("2026-11-10", "ar", true)).toBe("الثلاثاء 10 نوفمبر");
  expect(scheduleDateLabel("2026-11-01", "en")).toBe("1 November");
  expect(scheduleDateLabel("2026-11-10", "en", true)).toBe("Tuesday 10 November");
});

// Run this file with TZ=UTC and TZ=Africa/Cairo: date-only labels must not
// depend on the SSR/browser timezone, including the Cairo DST boundary.
it("keeps month boundaries and Cairo DST dates on their stored calendar day", () => {
  expect(scheduleDateLabel("2026-04-24", "ar", true)).toBe("الجمعة 24 أبريل");
  expect(scheduleDateLabel("2026-04-24", "en", true)).toBe("Friday 24 April");
  expect(scheduleDateLabel("2026-10-30", "ar", true)).toBe("الجمعة 30 أكتوبر");
  expect(scheduleDateLabel("2026-10-30", "en", true)).toBe("Friday 30 October");
  expect(scheduleDateLabel("2028-02-29", "ar")).toBe("29 فبراير");
  expect(scheduleDateLabel("2028-03-01", "en")).toBe("1 March");
});
