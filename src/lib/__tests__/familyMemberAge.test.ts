import { describe, expect, it } from "vitest";
import {
  memberAgeFromDate,
  memberAgeToDate,
  memberAgeTranslation,
  memberMaxYears,
  memberToday,
} from "../familyMemberAge";

describe("member age calendar conversion shared by web and mobile", () => {
  it("stores the first of the month and round-trips every under-two age across a year boundary", () => {
    for (let months = 0; months < 24; months++) {
      const age = { years: Math.floor(months / 12), months: months % 12 };
      const date = memberAgeToDate(age, "2026-01-31");
      expect(date).toMatch(/-01$/);
      expect(memberAgeFromDate(date, "2026-01-31")).toEqual(age);
    }
  });
  it("preserves infant month counts and uses whole years from age two", () => {
    expect(memberAgeToDate({ years: 0, months: 8 }, "2026-11-02")).toBe("2026-03-01");
    expect(memberAgeToDate({ years: 1, months: 11 }, "2026-11-02")).toBe("2024-12-01");
    expect(memberAgeToDate({ years: 3, months: 8 }, "2026-11-02")).toBe("2023-11-01");
    expect(memberAgeTranslation("2025-03-01", "2026-11-02")).toEqual({
      key: "memberAge.monthCount_many",
      count: 20,
    });
    expect(memberAgeTranslation("2023-11-01", "2026-11-02")).toEqual({
      key: "memberAge.yearCount_few",
      count: 3,
    });
  });
  it("counts complete months for existing precise birthdays, including leap days", () => {
    expect(memberAgeFromDate("2024-02-29", "2025-02-28")).toEqual({ years: 0, months: 11 });
    expect(memberAgeFromDate("2024-02-29", "2025-03-01")).toEqual({ years: 1, months: 0 });
    expect(memberAgeFromDate("2026-10-31", "2026-11-02")).toEqual({ years: 0, months: 0 });
    expect(memberAgeFromDate("2026-02-30", "2026-11-02")).toBeNull();
    expect(memberAgeFromDate("2027-01-01", "2026-11-02")).toBeNull();
  });
  it("uses Cairo's date even on a UTC device", () => {
    expect(memberToday(new Date("2026-01-31T22:30:00Z"))).toBe("2026-02-01");
    expect(
      memberAgeToDate({ years: 0, months: 1 }, memberToday(new Date("2026-01-31T22:30:00Z"))),
    ).toBe("2026-01-01");
  });
  it("allows 0–17 for children, 0–99 otherwise, and rejects invalid input", () => {
    expect(memberMaxYears("son")).toBe(17);
    expect(memberMaxYears("daughter")).toBe(17);
    expect(memberMaxYears("spouse")).toBe(99);
    expect(
      memberAgeFromDate(memberAgeToDate({ years: 99, months: 0 }, "2026-11-02"), "2026-11-02")
        ?.years,
    ).toBe(99);
    for (const age of [
      { years: -1, months: 0 },
      { years: 100, months: 0 },
      { years: 1, months: 12 },
      { years: 1.5, months: 0 },
    ])
      expect(() => memberAgeToDate(age, "2026-11-02")).toThrow();
  });
});
