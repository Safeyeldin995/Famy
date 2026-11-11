import { beforeEach, describe, expect, it, vi } from "vitest";

const recordOtpSendAttemptIfAllowed = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({ headers: new Headers() }),
}));

vi.mock("@/lib/otp/otpSendAttempts.server", () => ({
  recordOtpSendAttemptIfAllowed,
  requestClientIpForOtpSend: () => "203.0.113.9",
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    })),
  },
}));

describe("OTP send rate limit ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OTP_PROVIDER", "firebase");
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
  });

  it("does not run account lookup when pre-send rate limit rejects", async () => {
    recordOtpSendAttemptIfAllowed.mockResolvedValue({
      ok: false,
      error: "rate_limited",
      retryAfter: 120,
    });
    const otpHandlers = await import("@/lib/otp/otpHandlers.server");
    const findSpy = vi.spyOn(otpHandlers, "findUserIdByPhone");

    const { withMobileAuthCookies } = await import("@/lib/auth/authIntent.server");
    const { result } = await withMobileAuthCookies(undefined, () =>
      otpHandlers.mobileOtpSendHandler({ phone: "+201012345678", purpose: "signup", role: "customer" }),
    );

    expect(result).toMatchObject({ ok: false, error: "rate_limited", retryAfter: 120 });
    expect(recordOtpSendAttemptIfAllowed).toHaveBeenCalledTimes(1);
    expect(findSpy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
