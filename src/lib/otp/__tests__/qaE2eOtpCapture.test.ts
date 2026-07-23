import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  captureOtpForQaE2e,
  consumeCapturedQaE2eOtp,
  isQaE2eOtpCaptureEnabled,
} from "../qaE2eOtpCapture.server";

const CAPTURE_DIR = path.resolve(process.cwd(), "qa/.otp-capture");

describe("qaE2eOtpCapture", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    if (fs.existsSync(CAPTURE_DIR)) {
      for (const file of fs.readdirSync(CAPTURE_DIR)) {
        fs.unlinkSync(path.join(CAPTURE_DIR, file));
      }
    }
  });

  it("allows capture in test when QA_E2E_OTP_CAPTURE=1", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("QA_E2E_OTP_CAPTURE", "1");
    expect(isQaE2eOtpCaptureEnabled()).toBe(true);
    captureOtpForQaE2e("+201012345678", "SIGNUP", "123456");
    expect(consumeCapturedQaE2eOtp("+201012345678", "SIGNUP")).toBe("123456");
    expect(fs.existsSync(path.join(CAPTURE_DIR, `${encodeURIComponent("+201012345678")}__SIGNUP.otp`))).toBe(false);
  });

  it("throws in production when QA_E2E_OTP_CAPTURE=1", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("QA_E2E_OTP_CAPTURE", "1");
    expect(() => isQaE2eOtpCaptureEnabled()).toThrow(/forbidden in production/i);
    expect(() => captureOtpForQaE2e("+201012345678", "SIGNUP", "123456")).toThrow(/forbidden in production/i);
  });

  it("does not capture when flag is unset", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("QA_E2E_OTP_CAPTURE", "");
    captureOtpForQaE2e("+201012345678", "SIGNUP", "123456");
    expect(consumeCapturedQaE2eOtp("+201012345678", "SIGNUP")).toBeNull();
  });
});
