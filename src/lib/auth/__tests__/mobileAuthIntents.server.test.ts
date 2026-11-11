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
  getRequestHeader: () => undefined,
  getRequest: () => ({ headers: new Headers() }),
}));

function intentsHeaderFromPayload(payload: {
  otpPending?: string | null;
  setPassword?: string | null;
}) {
  return JSON.stringify(payload);
}

const rpc = vi.hoisted(() => vi.fn());
const profileLookup = vi.hoisted(() => vi.fn());

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

describe("mobile auth intents header transport", () => {
  beforeEach(() => {
    cookieStore.clear();
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
    rpc.mockResolvedValue({ data: null, error: null });
    profileLookup.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    delete process.env.AUTH_INTENT_SECRET;
  });

  it("returns otp pending and clears set-password in one response", async () => {
    const { mobileOtpSendHandler } = await import("@/lib/otp/otpHandlers.server");
    const { withMobileAuthCookies, setSetPasswordIntent } = await import(
      "@/lib/auth/authIntent.server"
    );

    vi.stubEnv("OTP_PROVIDER", "firebase");

    const seeded = await withMobileAuthCookies(undefined, async () => {
      setSetPasswordIntent({ authId: "11111111-1111-1111-1111-111111111111" });
      return null;
    });
    expect(seeded.intents.setPassword).toEqual(expect.any(String));

    const { result, intents } = await withMobileAuthCookies(
      JSON.stringify(seeded.intents),
      () => mobileOtpSendHandler({ phone: "+201012345678", purpose: "signup", role: "customer" }),
    );

    expect(result).toMatchObject({ ok: true, requiresVerification: true });
    expect(intents.otpPending).toEqual(expect.any(String));
    expect(intents.setPassword).toBeNull();

    vi.unstubAllEnvs();
  });

  it("round-trips both intents through the header jar", async () => {
    const { mobileOtpSendHandler, confirmFirebaseOtpSentHandler } = await import(
      "@/lib/otp/otpHandlers.server"
    );
    const { withMobileAuthCookies } = await import("@/lib/auth/authIntent.server");

    vi.stubEnv("OTP_PROVIDER", "firebase");
    rpc.mockResolvedValue({ data: "user-reset", error: null });

    const send = await withMobileAuthCookies(undefined, () =>
      mobileOtpSendHandler({ phone: "+201012345678", purpose: "reset" }),
    );
    const afterSend = await withMobileAuthCookies(
      intentsHeaderFromPayload(send.intents),
      () => confirmFirebaseOtpSentHandler(),
    );

    expect(afterSend.result).toEqual({ ok: true });
    expect(afterSend.intents.otpPending).toEqual(expect.any(String));
    expect(afterSend.intents.setPassword).toBeNull();

    vi.unstubAllEnvs();
  });
});
