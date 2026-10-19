import { expect, it } from "vitest";
import { formatNotificationDay } from "../notificationDay";
import { groupProviderNotifications } from "../journeyPresentation";
import { formatEGP } from "@/lib/format";
import { formatEGP as proScreenMoney } from "@/lib/utils";
const t = (key: string) => key;
it("uses Cairo midnight for both grouping and relative labels", () => {
  const now = new Date("2026-01-02T22:30:00Z");
  const before = new Date("2026-01-02T21:59:00Z");
  const after = new Date("2026-01-02T22:01:00Z");
  expect(formatNotificationDay(after, now, "ar", t)).toBe("proRound2.today");
  expect(formatNotificationDay(before, now, "ar", t)).toBe("proRound2.yesterday");
  expect(
    groupProviderNotifications([
      { created_at: before.toISOString() },
      { created_at: after.toISOString() },
    ]).map((g) => g.key),
  ).toEqual(["2026-01-03", "2026-01-02"]);
});
it("handles Cairo summer time and calendar-year boundaries", () => {
  expect(
    formatNotificationDay(
      new Date("2026-07-01T21:05:00Z"),
      new Date("2026-07-01T21:30:00Z"),
      "en",
      t,
    ),
  ).toBe("proRound2.today");
  expect(
    formatNotificationDay(
      new Date("2025-12-31T12:00:00Z"),
      new Date("2025-12-31T23:00:00Z"),
      "en",
      t,
    ),
  ).toBe("proRound2.yesterday");
});
it("formats older dates in Cairo with Arabic names and Latin digits, without time", () => {
  expect(
    formatNotificationDay(
      new Date("2026-09-01T22:00:00Z"),
      new Date("2026-09-10T12:00:00Z"),
      "ar",
      t,
    ),
  ).toBe("الأربعاء 2 سبتمبر");
});
it("uses the same money formatter and output as other pro screens", () => {
  expect(formatEGP).toBe(proScreenMoney);
  expect(formatEGP(3240, undefined, "ar")).toBe("3,240 ج.م");
  expect(formatEGP(3240, undefined, "en")).toBe("EGP 3,240");
});
