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
}));

describe("AUTH_INTENT_SECRET requirements", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.AUTH_INTENT_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("fails closed when AUTH_INTENT_SECRET is missing", async () => {
    delete process.env.AUTH_INTENT_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-must-not-work";
    const { requireAuthIntentSecret } = await import("../authIntent.server");
    expect(() => requireAuthIntentSecret()).toThrow(/AUTH_INTENT_SECRET is not configured/);
  });

  it("does not fall back to SUPABASE_SERVICE_ROLE_KEY", async () => {
    delete process.env.AUTH_INTENT_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-must-not-work";
    const { setOtpPendingIntent } = await import("../authIntent.server");
    expect(() => setOtpPendingIntent({
      phone: "+201221000633",
      purpose: "signup",
      retryAfterSeconds: 30,
    })).toThrow(/AUTH_INTENT_SECRET is not configured/);
  });

  it("rejects malformed cookies", async () => {
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
    const { readOtpPendingIntent } = await import("../authIntent.server");
    cookieStore.set("famy_otp_pending", "not-a-valid-token");
    expect(readOtpPendingIntent()).toBeNull();
  });

  it("rejects forged cookies signed with a different secret", async () => {
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
    const { setOtpPendingIntent, readOtpPendingIntent } = await import("../authIntent.server");
    setOtpPendingIntent({
      phone: "+201221000633",
      purpose: "signup",
      retryAfterSeconds: 30,
    });
    process.env.AUTH_INTENT_SECRET = "another-secret";
    vi.resetModules();
    const { readOtpPendingIntent: readWithOtherSecret } = await import("../authIntent.server");
    expect(readWithOtherSecret()).toBeNull();
  });
});
