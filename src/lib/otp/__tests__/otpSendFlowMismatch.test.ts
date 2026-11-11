import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const profileLookup = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({ headers: new Headers() }),
}));

vi.mock("@/lib/otp/otpSendAttempts.server", () => ({
  recordOtpSendAttemptIfAllowed: vi.fn().mockResolvedValue({ ok: true }),
  requestClientIpForOtpSend: vi.fn().mockReturnValue(null),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: () => profileLookup(),
              }),
            }),
          }),
        }),
      };
    },
  },
}));

describe("OTP send-time flow mismatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OTP_PROVIDER", "firebase");
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
  });

  it("blocks signup before Firebase intent when the phone already has an account", async () => {
    rpc.mockResolvedValue({ data: "user-existing", error: null });
    const { mobileOtpSendHandler } = await import("@/lib/otp/otpHandlers.server");
    const { withMobileAuthCookies } = await import("@/lib/auth/authIntent.server");

    const { result, intents } = await withMobileAuthCookies(undefined, () =>
      mobileOtpSendHandler({ phone: "+201012345678", purpose: "signup", role: "customer" }),
    );

    expect(result).toEqual({
      ok: false,
      error: "flow_mismatch",
      nextStep: "signin",
    });
    expect(intents.otpPending ?? null).toBeNull();
    vi.unstubAllEnvs();
  });

  it("blocks password reset send when no account exists for the phone", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    profileLookup.mockResolvedValue({ data: null, error: null });
    const { mobileOtpSendHandler } = await import("@/lib/otp/otpHandlers.server");
    const { withMobileAuthCookies } = await import("@/lib/auth/authIntent.server");

    const { result } = await withMobileAuthCookies(undefined, () =>
      mobileOtpSendHandler({ phone: "+201012345678", purpose: "reset" }),
    );

    expect(result).toEqual({
      ok: false,
      error: "flow_mismatch",
      nextStep: "signup",
    });
    vi.unstubAllEnvs();
  });
});
