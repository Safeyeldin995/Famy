import { describe, expect, it } from "vitest";
import { onboardingEditable } from "@/lib/provider/onboarding-queries";

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
});
