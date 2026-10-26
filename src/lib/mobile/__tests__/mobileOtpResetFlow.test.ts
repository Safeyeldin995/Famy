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

describe("mobile OTP reset purpose", () => {
  beforeEach(() => {
    cookieStore.clear();
    globalThis.__mobileTestIntentsHeader = undefined;
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
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
