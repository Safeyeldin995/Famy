import { describe, expect, it } from "vitest";
import { canRequestUpdatedDetails, onboardingEditable } from "@/lib/provider/onboarding-queries";

describe("provider onboarding helpers", () => {
  it("allows edit only in DRAFT and NEEDS_CHANGES", () => {
    expect(onboardingEditable("DRAFT")).toBe(true);
    expect(onboardingEditable("NEEDS_CHANGES")).toBe(true);
    expect(onboardingEditable("SUBMITTED")).toBe(false);
    expect(onboardingEditable("UNDER_REVIEW")).toBe(false);
    expect(onboardingEditable("APPROVED")).toBe(false);
    expect(onboardingEditable("REJECTED")).toBe(false);
    expect(onboardingEditable("SUSPENDED")).toBe(false);
    expect(onboardingEditable(undefined)).toBe(false);
  });

  it("offers request updated details only for APPROVED providers", () => {
    expect(canRequestUpdatedDetails("APPROVED")).toBe(true);
    expect(canRequestUpdatedDetails("NEEDS_CHANGES")).toBe(false);
    expect(canRequestUpdatedDetails("SUBMITTED")).toBe(false);
    expect(canRequestUpdatedDetails("UNDER_REVIEW")).toBe(false);
    expect(canRequestUpdatedDetails("DRAFT")).toBe(false);
    expect(canRequestUpdatedDetails(undefined)).toBe(false);
  });
});
