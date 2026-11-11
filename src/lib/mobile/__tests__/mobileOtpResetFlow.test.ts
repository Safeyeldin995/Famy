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
  getRequestHeader: (name: string) => {
    if (name.toLowerCase() !== "x-famy-auth-intents") return undefined;
    return globalThis.__mobileTestIntentsHeader;
  },
  getRequest: () => ({ headers: new Headers() }),
}));

declare global {
  // eslint-disable-next-line no-var
  var __mobileTestIntentsHeader: string | undefined;
}

const rpc = vi.hoisted(() => vi.fn());
const profileLookup = vi.hoisted(() => vi.fn());

vi.mock("@/lib/otp/otpSendAttempts.server", () => ({
  recordOtpSendAttemptIfAllowed: vi.fn().mockResolvedValue({ ok: true }),
  requestClientIpForOtpSend: vi.fn().mockReturnValue(null),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => {
      if (table === "otp_send_attempts") {
        return {
          select: () => ({
            eq: () => ({
              gte: async () => ({ count: 0, error: null }),
            }),
          }),
          insert: async () => ({ error: null }),
          delete: () => ({
            eq: () => ({
              lt: async () => ({ error: null }),
            }),
          }),
        };
      }
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

describe("mobile OTP reset purpose", () => {
  beforeEach(() => {
    cookieStore.clear();
    globalThis.__mobileTestIntentsHeader = undefined;
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
    rpc.mockResolvedValue({ data: "user-reset", error: null });
    profileLookup.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    delete process.env.AUTH_INTENT_SECRET;
    globalThis.__mobileTestIntentsHeader = undefined;
  });

  it("prepares firebase reset intent and confirms delivery", async () => {
    const { mobileOtpSendHandler, confirmFirebaseOtpSentHandler, getOtpScreenContextHandler } =
      await import("@/lib/otp/otpHandlers.server");
    const { withMobileAuthCookies } = await import("@/lib/auth/authIntent.server");

    vi.stubEnv("OTP_PROVIDER", "firebase");

    const send = await withMobileAuthCookies(undefined, () =>
      mobileOtpSendHandler({ phone: "+201012345678", purpose: "reset" }),
    );
    expect(send.result).toMatchObject({ ok: true, requiresVerification: true });
    globalThis.__mobileTestIntentsHeader = JSON.stringify(send.intents);

    const confirm = await withMobileAuthCookies(JSON.stringify(send.intents), () =>
      confirmFirebaseOtpSentHandler(),
    );
    expect(confirm.result).toEqual({ ok: true });
    globalThis.__mobileTestIntentsHeader = JSON.stringify(confirm.intents);

    const context = await withMobileAuthCookies(JSON.stringify(confirm.intents), () =>
      getOtpScreenContextHandler(),
    );
    expect(context.result.ok).toBe(true);
    if (context.result.ok) {
      expect(context.result.purpose).toBe("reset");
      expect(context.result.delivery).toBe("firebase");
    }

    vi.unstubAllEnvs();
  });
});
