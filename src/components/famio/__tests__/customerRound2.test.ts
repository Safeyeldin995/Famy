import { describe, expect, it } from "vitest";
import { groupCustomerNotifications, notificationText } from "../customerNotifications";
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
  it("groups by local calendar date, newest first, without mutating the source", () => {
    const now = new Date(2026, 0, 1, 0, 30);
    const items = [
      { id: "old", created_at: new Date(2025, 11, 29, 12).toISOString() },
      { id: "yesterday", created_at: new Date(2025, 11, 31, 23, 59).toISOString() },
      { id: "today", created_at: new Date(2026, 0, 1, 0, 10).toISOString() },
      { id: "today-newer", created_at: new Date(2026, 0, 1, 0, 20).toISOString() },
    ];
    const groups = groupCustomerNotifications(items, "ar", now);
    expect(groups.map((g) => g.items.map((n) => n.id))).toEqual([
      ["today-newer", "today"],
      ["yesterday"],
      ["old"],
    ]);
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
