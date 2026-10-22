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

describe("mobile OTP API handlers", () => {
  beforeEach(() => {
    cookieStore.clear();
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
  });

  afterEach(() => {
    delete process.env.AUTH_INTENT_SECRET;
  });

  it("rejects verify without a pending intent", async () => {
    const { verifyOtpHandler } = await import("@/lib/otp/otpHandlers.server");
    const { withMobileAuthCookies } = await import("@/lib/auth/authIntent.server");
    const { result } = await withMobileAuthCookies(undefined, () =>
      verifyOtpHandler({ code: "123456" }),
    );
    expect(result).toEqual({ ok: false, error: "invalid_code" });
  });
});
