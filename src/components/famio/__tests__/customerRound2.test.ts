import { describe, expect, it } from "vitest";
import {
  formatCustomerNotificationTime,
  groupCustomerNotifications,
  notificationText,
} from "../customerNotifications";
import { birthDateDays } from "../CustomerBirthDateField";

describe("customer notification presentation", () => {
  it("prefers Arabic fields, normalizes their digits, and falls back when missing", () => {
    expect(
      notificationText(
        { title_ar: "حجز ٢", title_en: "Booking 2", body_ar: "الساعة ١٠", body_en: "At 10" },
        "ar",
      ),
    ).toEqual({ title: "حجز 2", body: "الساعة 10" });
    expect(notificationText({ title: "Legacy", body_en: "Body" }, "ar")).toEqual({
      title: "Legacy",
      body: "Body",
    });
    expect(notificationText({ title_ar: "عربي", title_en: "English" }, "en").title).toBe("English");
  });
  it("groups by Cairo calendar date, newest first, without mutating the source", () => {
    const now = new Date("2026-01-01T00:30:00+02:00");
    const items = [
      { id: "old", created_at: new Date("2025-12-29T12:00:00+02:00").toISOString() },
      { id: "yesterday", created_at: new Date("2025-12-31T23:59:00+02:00").toISOString() },
      { id: "today", created_at: new Date("2026-01-01T00:10:00+02:00").toISOString() },
      { id: "today-newer", created_at: new Date("2026-01-01T00:20:00+02:00").toISOString() },
    ];
    const groups = groupCustomerNotifications(items, "ar", now);
    expect(groups.map((g) => g.items.map((n) => n.id))).toEqual([
      ["today-newer", "today"],
      ["yesterday"],
      ["old"],
    ]);
    expect(formatCustomerNotificationTime(now, "en")).toBe("12:30 AM");
    expect(groups[0].key).toBe("2026-01-01");
    expect(groupCustomerNotifications(items, "en", now)[1].label).toBe("Yesterday");
    expect(groups[0].label).toBe("النهارده");
    expect(groups[1].label).toBe("امبارح");
    expect(groups[2].label).toMatch(/29.*2025/);
    expect(groups[2].label).not.toMatch(/[٠-٩]/);
    expect(items[0].id).toBe("old");
    expect(groupCustomerNotifications([], "ar", now)).toEqual([]);
  });
});
describe("birthday calendar", () => {
  it("offers correct day counts, including leap years", () => {
    expect(birthDateDays("2024", "02")).toBe(29);
    expect(birthDateDays("2025", "02")).toBe(28);
    expect(birthDateDays("2020", "04")).toBe(30);
  });
});
