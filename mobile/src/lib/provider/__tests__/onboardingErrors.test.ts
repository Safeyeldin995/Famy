import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { onboardingMutationErrorMessage } from "../onboardingErrors";

const known: Record<string, string> = {
  "pro.onboardingWizard.errors.phone_required": "Phone required",
  "pro.onboardingWizard.errors.provider_price_invalid": "Price invalid",
  "providerApply.saveError": "Save failed",
};

const t = ((key: string, opts?: { defaultValue?: string }) => {
  if (known[key]) return known[key];
  return opts?.defaultValue ?? key;
}) as TFunction;

describe("onboardingMutationErrorMessage", () => {
  it("maps completion error codes to wizard copy", () => {
    const error = Object.assign(new Error("submission_incomplete"), {
      completionErrors: { personal: "phone_required" },
    });
    expect(onboardingMutationErrorMessage(t, error)).toBe("Phone required");
  });

  it("maps provider_price_invalid when translated", () => {
    const error = Object.assign(new Error("submission_incomplete"), {
      completionErrors: { services: "provider_price_invalid" },
    });
    expect(onboardingMutationErrorMessage(t, error)).toBe("Price invalid");
  });

  it("falls back to generic copy for unmapped server codes", () => {
    const error = Object.assign(new Error("submission_incomplete"), {
      completionErrors: { services: "unknown_future_code" },
    });
    expect(onboardingMutationErrorMessage(t, error)).toBe("Save failed");
  });

  it("falls back when no server codes are present", () => {
    expect(onboardingMutationErrorMessage(t, new Error("network"))).toBe("Save failed");
  });
});