import { describe, expect, it } from "vitest";
import {
  providerCanUseNativeApp,
  providerStatusBodyKey,
  providerStatusNativePath,
  providerStatusTitleKey,
} from "../gates";

describe("providerStatusNativePath", () => {
  it("routes draft and missing providers to apply", () => {
    expect(providerStatusNativePath(false, undefined)).toBe("/pro-apply");
    expect(providerStatusNativePath(true, "DRAFT")).toBe("/pro-apply");
    expect(providerStatusNativePath(true, null)).toBe("/pro-apply");
  });

  it("routes post-draft onboarding statuses to setup home", () => {
    for (const status of ["NEEDS_CHANGES", "REJECTED", "SUSPENDED"]) {
      expect(providerStatusNativePath(true, status)).toBe("/pro-setup-home");
    }
  });

  it("routes submitted and under review to setup home (#448)", () => {
    expect(providerStatusNativePath(true, "SUBMITTED")).toBe("/pro-setup-home");
    expect(providerStatusNativePath(true, "UNDER_REVIEW")).toBe("/pro-setup-home");
  });

  it("keeps gated providers on routes that include the account menu (#447)", () => {
    const gated = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "NEEDS_CHANGES", "REJECTED", "SUSPENDED"];
    for (const status of gated) {
      const path = providerStatusNativePath(true, status);
      expect(["/pro-apply", "/pro-setup-home"]).toContain(path);
    }
  });
});

describe("provider gate copy helpers", () => {
  it("exposes distinct title keys per terminal status (#459)", () => {
    expect(providerStatusTitleKey(true, "REJECTED")).toBe("pro.onboardingWizard.status.REJECTED");
    expect(providerStatusTitleKey(true, "SUSPENDED")).toBe("pro.onboardingWizard.status.SUSPENDED");
    expect(providerStatusTitleKey(true, "UNDER_REVIEW")).toBe(
      "pro.onboardingWizard.status.UNDER_REVIEW",
    );
  });

  it("maps under-review body copy", () => {
    expect(providerStatusBodyKey(true, "UNDER_REVIEW")).toBe(
      "pro.onboardingWizard.statusBody.UNDER_REVIEW",
    );
  });
});

describe("providerCanUseNativeApp", () => {
  it("allows only approved providers", () => {
    expect(providerCanUseNativeApp(true, "APPROVED")).toBe(true);
    for (const status of ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "NEEDS_CHANGES", "REJECTED"]) {
      expect(providerCanUseNativeApp(true, status)).toBe(false);
    }
    expect(providerCanUseNativeApp(false, "APPROVED")).toBe(false);
  });
});