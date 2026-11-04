import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyMember, memberInput, validMember } from "../familyForm";
import { memberAgeFromDate, memberAgeToDate } from "@shared/familyMemberAge";

afterEach(() => vi.useRealTimers());
describe("native age-picker saving", () => {
  it("round-trips years and infant months and marks new/edited rows estimated", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
    for (const age of [
      { years: 0, months: 8 },
      { years: 1, months: 11 },
      { years: 3, months: 0 },
    ]) {
      const value = {
        ...emptyMember(),
        full_name: "Test child",
        date_of_birth: memberAgeToDate(age),
      };
      expect(validMember(value, false, "2026-11-02")).toBe(true);
      const saved = memberInput(value);
      expect(saved.date_of_birth_is_estimated).toBe(true);
      expect(memberAgeFromDate(saved.date_of_birth)).toEqual(age);
    }
  });
  it("converts a precise existing date only on save and enforces relationship limits", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
    const value = { ...emptyMember(), full_name: "Test member", date_of_birth: "2025-02-15" };
    expect(memberInput(value).date_of_birth).toBe("2025-03-01");
    expect(value.date_of_birth).toBe("2025-02-15");
    const adult = { ...value, date_of_birth: "1990-01-01" };
    expect(validMember(adult, false, "2026-11-02")).toBe(false);
    expect(validMember({ ...adult, relationship: "spouse" }, false, "2026-11-02")).toBe(true);
  });
});
