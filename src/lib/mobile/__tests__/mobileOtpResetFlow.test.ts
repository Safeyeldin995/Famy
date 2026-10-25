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
    if (name.toLowerCase() !== "cookie") return undefined;
    return [...cookieStore.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  },
  getRequest: () => ({ headers: new Headers() }),
}));

function cookieHeaderFromSetCookies(setCookies: string[]): string {
  return setCookies
    .map((raw) => raw.split(";")[0]?.trim())
    .filter((pair) => pair && !pair.endsWith("="))
    .join("; ");
}

describe("mobile OTP reset purpose", () => {
  beforeEach(() => {
    cookieStore.clear();
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
  });

  afterEach(() => {
    delete process.env.AUTH_INTENT_SECRET;
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
    const cookieAfterSend = cookieHeaderFromSetCookies(send.setCookieHeaders);

    const confirm = await withMobileAuthCookies(cookieAfterSend, () =>
      confirmFirebaseOtpSentHandler(),
    );
    expect(confirm.result).toEqual({ ok: true });
    const cookieAfterConfirm =
      cookieHeaderFromSetCookies(confirm.setCookieHeaders) || cookieAfterSend;

    const context = await withMobileAuthCookies(cookieAfterConfirm, () =>
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
