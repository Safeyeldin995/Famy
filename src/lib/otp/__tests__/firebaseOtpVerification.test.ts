import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecodedIdToken } from "firebase-admin/auth";
import {
  FirebaseAdminConfigurationError,
  readFirebaseAdminConfig,
  resetFirebaseAdminAuthForTests,
  verifyFirebasePhoneIdToken,
} from "../firebaseAdmin.server";

describe("readFirebaseAdminConfig", () => {
  it("reads Firebase admin credentials from env", () => {
    const config = readFirebaseAdminConfig({
      FIREBASE_PROJECT_ID: "famy-fa9ad",
      FIREBASE_CLIENT_EMAIL: "firebase-adminsdk@test.iam.gserviceaccount.com",
      FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    });
    expect(config.projectId).toBe("famy-fa9ad");
    expect(config.privateKey).toContain("\n");
  });

  it("fails closed when server credentials are missing", () => {
    expect(() => readFirebaseAdminConfig({})).toThrow(FirebaseAdminConfigurationError);
  });
});

describe("verifyFirebasePhoneIdToken", () => {
  afterEach(() => {
    resetFirebaseAdminAuthForTests();
    vi.restoreAllMocks();
  });

  const decodedBase: DecodedIdToken = {
    aud: "famy-fa9ad",
    auth_time: 1,
    exp: 9999999999,
    firebase: { identities: {}, sign_in_provider: "phone" },
    iat: 1,
    iss: "https://securetoken.google.com/famy-fa9ad",
    sub: "firebase-user-1",
    uid: "firebase-user-1",
    phone_number: "+201012345678",
  };

  it("accepts a valid token when phone numbers match in E.164", async () => {
    const verifyToken = vi.fn().mockResolvedValue(decodedBase);
    const result = await verifyFirebasePhoneIdToken("valid-token", "+201012345678", verifyToken);
    expect(result).toEqual({ ok: true, phoneE164: "+201012345678", decoded: decodedBase });
    expect(verifyToken).toHaveBeenCalledWith("valid-token");
  });

  it("rejects expired or invalid tokens", async () => {
    const verifyToken = vi.fn().mockRejectedValue({ code: "auth/id-token-expired" });
    const result = await verifyFirebasePhoneIdToken("expired-token", "+201012345678", verifyToken);
    expect(result).toEqual({ ok: false, error: "expired_token" });
  });

  it("rejects tokens without a phone number claim", async () => {
    const verifyToken = vi.fn().mockResolvedValue({ ...decodedBase, phone_number: undefined });
    const result = await verifyFirebasePhoneIdToken(
      "missing-phone-token",
      "+201012345678",
      verifyToken,
    );
    expect(result).toEqual({ ok: false, error: "missing_phone" });
  });

  it("rejects when token phone does not match the pending intent phone", async () => {
    const verifyToken = vi.fn().mockResolvedValue(decodedBase);
    const result = await verifyFirebasePhoneIdToken("valid-token", "+201099999999", verifyToken);
    expect(result).toEqual({ ok: false, error: "phone_mismatch" });
  });
});

describe("resolveOtpProviderKind", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows firebase in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PROVIDER", "firebase");
    const { resolveOtpProviderKind } = await import("../otpProviderKind.server");
    expect(resolveOtpProviderKind()).toBe("firebase");
  });

  it("rejects mock in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PROVIDER", "mock");
    const { resolveOtpProviderKind } = await import("../otpProviderKind.server");
    expect(() => resolveOtpProviderKind()).toThrow(
      /Production requires OTP_PROVIDER=meta or OTP_PROVIDER=firebase/,
    );
  });
});
