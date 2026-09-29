import { describe, expect, it } from "vitest";
import {
  isChildOnlyBookingCategory,
  isForWhomStepComplete,
  resolveBookingFamilyMemberId,
  shouldShowMyselfBookingOption,
} from "@/lib/booking/childOnlyBookingRecipient";

describe("childOnlyBookingRecipient", () => {
  it("treats babysitting and tutoring as child-only", () => {
    expect(isChildOnlyBookingCategory("babysitting")).toBe(true);
    expect(isChildOnlyBookingCategory("tutoring")).toBe(true);
    expect(isChildOnlyBookingCategory("home-cleaning")).toBe(false);
  });

  it("hides Myself for child-only categories", () => {
    expect(shouldShowMyselfBookingOption("tutoring")).toBe(false);
    expect(shouldShowMyselfBookingOption("home-cleaning")).toBe(true);
  });

  it("requires a saved family member for child-only booking steps", () => {
    expect(
      isForWhomStepComplete({
        categorySlug: "tutoring",
        forWhom: "myself",
        familyMemberIds: ["child-1"],
      }),
    ).toBe(false);
    expect(
      isForWhomStepComplete({
        categorySlug: "tutoring",
        forWhom: "child-1",
        familyMemberIds: ["child-1"],
      }),
    ).toBe(true);
    expect(
      isForWhomStepComplete({
        categorySlug: "home-cleaning",
        forWhom: "myself",
        familyMemberIds: [],
      }),
    ).toBe(true);
  });

  it("maps Myself to null and members to ids", () => {
    expect(
      resolveBookingFamilyMemberId({ categorySlug: "tutoring", forWhom: "myself" }),
    ).toBeNull();
    expect(resolveBookingFamilyMemberId({ categorySlug: "tutoring", forWhom: "child-1" })).toBe(
      "child-1",
    );
  });
});
