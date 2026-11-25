import { describe, expect, it } from "vitest";
import { onboardingMutationErrorMessage } from "../onboardingErrors";

const t = (key: string) => key;

describe("onboardingMutationErrorMessage", () => {
  it("maps completion error codes to wizard copy", () => {
    const error = Object.assign(new Error("submission_incomplete"), {
      completionErrors: { personal: "phone_required" },
    });
    expect(onboardingMutationErrorMessage(t, error)).toBe(
      "pro.onboardingWizard.errors.phone_required",
    );
  });

  it("falls back when no server codes are present", () => {
    expect(onboardingMutationErrorMessage(t, new Error("network"))).toBe("providerApply.saveError");
  });
});