import { describe, expect, it } from "vitest";
import {
  shouldShowMobileCustomerExplanationPushModal,
  shouldShowMobileLaunchPushModal,
} from "@/lib/push/mobilePromptPolicy";

describe("mobile push prompt policy", () => {
  it("shows launch modal for provider only while permission is undetermined", () => {
    expect(shouldShowMobileLaunchPushModal("provider", "undetermined", false)).toBe(true);
    expect(shouldShowMobileLaunchPushModal("customer", "undetermined", false)).toBe(false);
    expect(shouldShowMobileLaunchPushModal("provider", "undetermined", true)).toBe(false);
    expect(shouldShowMobileLaunchPushModal("provider", "granted", false)).toBe(false);
  });

  it("defers customer OS prompt to the post-booking explanation flow", () => {
    expect(shouldShowMobileCustomerExplanationPushModal("undetermined", false)).toBe(true);
    expect(shouldShowMobileCustomerExplanationPushModal("undetermined", true)).toBe(false);
    expect(shouldShowMobileCustomerExplanationPushModal("denied", false)).toBe(false);
  });
});