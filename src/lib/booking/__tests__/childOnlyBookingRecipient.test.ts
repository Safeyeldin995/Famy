import { describe, expect, it } from "vitest";
import {
  isBabysittingBookingCategory,
  isForWhomStepComplete,
  resolveBookingFamilyMemberId,
  shouldShowMyselfBookingOption,
} from "@/lib/booking/childOnlyBookingRecipient";

describe("booking recipient policy", () => {
  it("requires a saved child for babysitting only", () => {
    expect(isBabysittingBookingCategory("babysitting")).toBe(true);
    expect(isBabysittingBookingCategory("tutoring")).toBe(false);
    expect(isBabysittingBookingCategory("home-cleaning")).toBe(false);
  });

  it("allows Myself for tutoring and hides it for babysitting", () => {
    expect(shouldShowMyselfBookingOption("tutoring")).toBe(true);
    expect(shouldShowMyselfBookingOption("babysitting")).toBe(false);
    expect(shouldShowMyselfBookingOption("home-cleaning")).toBe(true);
  });

  it("accepts Myself or any owned member for tutoring", () => {
    expect(
      isForWhomStepComplete({
        categorySlug: "tutoring",
        forWhom: "myself",
        familyMemberIds: [],
      }),
    ).toBe(true);
    expect(
      isForWhomStepComplete({
        categorySlug: "tutoring",
        forWhom: "adult-1",
        familyMemberIds: ["adult-1"],
      }),
    ).toBe(true);
    expect(
      isForWhomStepComplete({
        categorySlug: "babysitting",
        forWhom: "myself",
        familyMemberIds: ["child-1"],
      }),
    ).toBe(false);
    expect(
      isForWhomStepComplete({
        categorySlug: "babysitting",
        forWhom: "child-1",
        familyMemberIds: ["child-1"],
      }),
    ).toBe(true);
  });

  it("maps Myself to null and members to ids", () => {
    expect(
      resolveBookingFamilyMemberId({ categorySlug: "tutoring", forWhom: "myself" }),
    ).toBeNull();
    expect(resolveBookingFamilyMemberId({ categorySlug: "tutoring", forWhom: "member-1" })).toBe(
      "member-1",
    );
  });
});
