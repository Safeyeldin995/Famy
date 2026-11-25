import { describe, expect, it } from "vitest";
import { providerOnboardingTerminal, providerStatusTitleKey } from "../gates";

describe("pending home terminal statuses (#459)", () => {
  it("treats rejected and suspended as terminal", () => {
    expect(providerOnboardingTerminal("REJECTED")).toBe(true);
    expect(providerOnboardingTerminal("SUSPENDED")).toBe(true);
    expect(providerOnboardingTerminal("UNDER_REVIEW")).toBe(false);
    expect(providerOnboardingTerminal("NEEDS_CHANGES")).toBe(false);
  });

  it("uses distinct status titles for rejected and suspended", () => {
    expect(providerStatusTitleKey(true, "REJECTED")).not.toBe(
      providerStatusTitleKey(true, "UNDER_REVIEW"),
    );
    expect(providerStatusTitleKey(true, "SUSPENDED")).toBe("pro.onboardingWizard.status.SUSPENDED");
  });
});