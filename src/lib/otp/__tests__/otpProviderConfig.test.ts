import { describe, expect, it } from "vitest";
import {
  OtpProviderConfigurationError,
  resolveClientOtpProviderKind,
} from "../otpProviderConfig";

describe("resolveClientOtpProviderKind", () => {
  it("returns configured provider values in development", () => {
    expect(resolveClientOtpProviderKind({ configured: "firebase", isProduction: false })).toBe(
      "firebase",
    );
    expect(resolveClientOtpProviderKind({ configured: "http_sms", isProduction: false })).toBe(
      "http_sms",
    );
  });

  it("defaults to mock in development when unset", () => {
    expect(resolveClientOtpProviderKind({ configured: "", isProduction: false })).toBe("mock");
  });

  it("throws in production when provider is missing or unknown", () => {
    expect(() =>
      resolveClientOtpProviderKind({ configured: "", isProduction: true }),
    ).toThrow(OtpProviderConfigurationError);
    expect(() =>
      resolveClientOtpProviderKind({ configured: "unknown", isProduction: true }),
    ).toThrow(OtpProviderConfigurationError);
  });
});
