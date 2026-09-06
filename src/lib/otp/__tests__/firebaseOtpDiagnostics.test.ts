import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthIntentConfigurationError } from "@/lib/auth/authIntent.server";
import {
  classifyFirebaseOtpBeginError,
  maskPhoneSuffix,
} from "../firebaseOtpDiagnostics.server";

describe("firebaseOtpDiagnostics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("masks phone to last two digits only", () => {
    expect(maskPhoneSuffix("+201012345678")).toBe("78");
    expect(maskPhoneSuffix("1")).toBeNull();
  });

  it("classifies missing auth intent secret", () => {
    const classified = classifyFirebaseOtpBeginError(new AuthIntentConfigurationError());
    expect(classified).toEqual({
      reason: "auth_intent_secret_missing",
      errorName: "AuthIntentConfigurationError",
      errorMessage: "AUTH_INTENT_SECRET is not configured",
    });
  });

  it("classifies invalid phone errors", () => {
    const classified = classifyFirebaseOtpBeginError(new Error("Invalid E.164 phone"));
    expect(classified.reason).toBe("invalid_phone");
  });
});

describe("getOtpProviderConfigurationStatus", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reports unset provider in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.OTP_PROVIDER;
    const { getOtpProviderConfigurationStatus } = await import("../otpProviderKind.server");
    expect(getOtpProviderConfigurationStatus()).toEqual({ ok: false, configured: "unset" });
  });

  it("reports firebase when configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PROVIDER", "firebase");
    const { getOtpProviderConfigurationStatus } = await import("../otpProviderKind.server");
    expect(getOtpProviderConfigurationStatus()).toEqual({ ok: true, kind: "firebase" });
  });
});
