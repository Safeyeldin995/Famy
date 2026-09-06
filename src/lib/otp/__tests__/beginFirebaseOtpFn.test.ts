import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => cookieStore.get(name),
  setCookie: (name: string, value: string) => {
    cookieStore.set(name, value);
  },
  deleteCookie: (name: string) => {
    cookieStore.delete(name);
  },
  getRequest: () => ({ headers: new Headers() }),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder: {
      inputValidator: () => typeof builder;
      handler: (handlerFn: (ctx: { data: unknown }) => unknown) => typeof handlerFn;
    } = {
      inputValidator: () => builder,
      handler: (handlerFn) => handlerFn,
    };
    return builder;
  },
}));

describe("beginFirebaseOtpFn", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.AUTH_INTENT_SECRET;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns provider_mismatch and logs when OTP_PROVIDER is unset", async () => {
    delete process.env.OTP_PROVIDER;
    const { beginFirebaseOtpFn } = await import("@/lib/otp.functions");
    const result = await beginFirebaseOtpFn({
      data: { phone: "+201012345678", purpose: "signup", role: "customer" },
    });
    expect(result).toEqual({
      ok: false,
      error: "provider_mismatch",
      message: "Firebase OTP is not active in this environment.",
    });
    expect(console.error).toHaveBeenCalledWith(
      "[otp.firebase.begin]",
      expect.objectContaining({
        reason: "provider_mismatch",
        configuredOtpProvider: "unset",
        authIntentSecretConfigured: true,
        phoneSuffix: "78",
      }),
    );
  });

  it("returns auth_intent_secret_missing when secret is absent", async () => {
    vi.stubEnv("OTP_PROVIDER", "firebase");
    delete process.env.AUTH_INTENT_SECRET;
    const { beginFirebaseOtpFn } = await import("@/lib/otp.functions");
    const result = await beginFirebaseOtpFn({
      data: { phone: "+201012345678", purpose: "signup", role: "customer" },
    });
    expect(result).toMatchObject({
      ok: false,
      error: "auth_intent_secret_missing",
    });
    expect(console.error).toHaveBeenCalledWith(
      "[otp.firebase.begin]",
      expect.objectContaining({
        reason: "auth_intent_secret_missing",
        configuredOtpProvider: "firebase",
        authIntentSecretConfigured: false,
      }),
    );
  });

  it("succeeds when firebase provider and auth intent secret are configured", async () => {
    vi.stubEnv("OTP_PROVIDER", "firebase");
    const { beginFirebaseOtpFn } = await import("@/lib/otp.functions");
    const result = await beginFirebaseOtpFn({
      data: { phone: "+201012345678", purpose: "signup", role: "customer" },
    });
    expect(result).toEqual({
      ok: true,
      retryAfter: 30,
      requiresVerification: true,
    });
  });
});
