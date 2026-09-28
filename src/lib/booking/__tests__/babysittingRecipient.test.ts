import { describe, expect, it } from "vitest";
import { ageInWholeMonthsUtc, childAgeMonthsInSupportedRange } from "@/lib/booking/childAgeMonths";
import {
  bookingFamilyMemberId,
  canContinueForWhom,
  defaultForWhom,
  showMyselfOption,
} from "@/lib/booking/babysittingRecipient";

describe("ageInWholeMonthsUtc", () => {
  it("matches PostgreSQL whole-month age at UTC calendar dates", () => {
    expect(ageInWholeMonthsUtc("2023-09-28", "2026-09-28T10:00:00Z")).toBe(36);
    expect(ageInWholeMonthsUtc("2023-09-29", "2026-09-28T10:00:00Z")).toBe(35);
    expect(ageInWholeMonthsUtc("2024-01-31", "2024-02-29T10:00:00Z")).toBe(0);
    expect(childAgeMonthsInSupportedRange(0)).toBe(true);
    expect(childAgeMonthsInSupportedRange(215)).toBe(true);
    expect(childAgeMonthsInSupportedRange(216)).toBe(false);
  });
});

describe("babysittingRecipient", () => {
  const child = { id: "child-1", date_of_birth: "2024-09-28" };

  it("hides Myself and requires a child for babysitting", () => {
    expect(showMyselfOption(true)).toBe(false);
    expect(defaultForWhom(true)).toBe("");
    expect(
      canContinueForWhom({
        isBabysitting: true,
        forWhom: "myself",
        members: [child],
        startAt: "2026-09-28T10:00:00Z",
      }),
    ).toBe(false);
    expect(
      canContinueForWhom({
        isBabysitting: true,
        forWhom: "child-1",
        members: [child],
        startAt: "2026-09-28T10:00:00Z",
      }),
    ).toBe(true);
    expect(bookingFamilyMemberId("myself")).toBeNull();
    expect(bookingFamilyMemberId("child-1")).toBe("child-1");
  });

  it("keeps Myself for home-cleaning", () => {
    expect(showMyselfOption(false)).toBe(true);
    expect(defaultForWhom(false)).toBe("myself");
    expect(
      canContinueForWhom({
        isBabysitting: false,
        forWhom: "myself",
        members: [],
        startAt: "2026-09-28T10:00:00Z",
      }),
    ).toBe(true);
  });
});
