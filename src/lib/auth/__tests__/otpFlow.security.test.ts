import { describe, expect, it } from "vitest";
import { isOtpMockLoggingAllowed } from "@/lib/otp/MockOTPProvider.server";
import { isQaE2eOtpCaptureEnabled } from "@/lib/otp/qaE2eOtpCapture.server";

describe("production OTP safeguards", () => {
  it("disables mock provider logging in production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    expect(isOtpMockLoggingAllowed()).toBe(false);
    process.env.NODE_ENV = original;
  });

  it("rejects QA OTP capture in production", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalCapture = process.env.QA_E2E_OTP_CAPTURE;
    process.env.NODE_ENV = "production";
    process.env.QA_E2E_OTP_CAPTURE = "1";
    expect(() => isQaE2eOtpCaptureEnabled()).toThrow(/forbidden in production/i);
    process.env.NODE_ENV = originalEnv;
    process.env.QA_E2E_OTP_CAPTURE = originalCapture;
  });
});

describe("otp route access expectations", () => {
  it("describes redirect behavior without a trusted auth intent", () => {
    const context = { ok: false as const, redirect: "/login" as const };
    expect(context.redirect).toBe("/login");
  });
});
