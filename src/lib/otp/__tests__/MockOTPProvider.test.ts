import { afterEach, describe, expect, it } from "vitest";
import {
  MockOTPProvider,
  assertMockOtpProviderAllowed,
  isOtpMockLoggingAllowed,
} from "../MockOTPProvider.server";

const meta = {
  purpose: "SIGNUP" as const,
  otp: "123456",
  timestamp: new Date("2026-07-22T12:00:00.000Z"),
  requestId: "test-request-id",
};

describe("MockOTPProvider", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("does not expose OTP retrieval APIs", () => {
    const provider = new MockOTPProvider();
    expect("getLatestCode" in provider).toBe(false);
    expect("clearLatestCode" in provider).toBe(false);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(provider))).toEqual(["constructor", "sendOTP"]);
  });

  it("allows sendOTP in development", async () => {
    process.env.NODE_ENV = "development";
    const provider = new MockOTPProvider();
    await expect(provider.sendOTP("+201012345678", "test", meta)).resolves.toBeUndefined();
  });

  it("allows sendOTP in test", async () => {
    process.env.NODE_ENV = "test";
    const provider = new MockOTPProvider();
    await expect(provider.sendOTP("+201012345678", "test", meta)).resolves.toBeUndefined();
  });

  it("rejects construction in production", () => {
    process.env.NODE_ENV = "production";
    expect(() => new MockOTPProvider()).toThrow(/not allowed in production/i);
  });

  it("assertMockOtpProviderAllowed throws in production", () => {
    process.env.NODE_ENV = "production";
    expect(() => assertMockOtpProviderAllowed()).toThrow(/not allowed in production/i);
  });

  it("isOtpMockLoggingAllowed is false in production", () => {
    process.env.NODE_ENV = "production";
    expect(isOtpMockLoggingAllowed()).toBe(false);
  });
});
