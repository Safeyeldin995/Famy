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

vi.mock("@/lib/auth/passwordSetupAuth.server", () => ({
  readPasswordSetupAuthorization: vi.fn(),
  isPasswordSetupAuthorizationActive: vi.fn(),
  fromDbOtpPurpose: (purpose: string) => (purpose === "SIGNUP" ? "signup" : "reset"),
}));

vi.mock("@/lib/auth/requestAuth.server", () => ({
  getRequestBearerUserId: vi.fn(),
}));

describe("direct /auth/set-password access", () => {
  beforeEach(() => {
    cookieStore.clear();
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.AUTH_INTENT_SECRET;
    vi.restoreAllMocks();
  });

  it("redirects to login when set-password cookie is missing", async () => {
    const { resolveSetPasswordContextFromCookie } = await import("@/lib/auth/passwordSetupContext.server");
    const context = await resolveSetPasswordContextFromCookie();
    expect(context).toEqual({ ok: false, redirect: "/login" });
  });

  it("redirects to login when authorization row is missing or inactive", async () => {
    const { setSetPasswordIntent } = await import("../authIntent.server");
    const { readPasswordSetupAuthorization, isPasswordSetupAuthorizationActive } = await import("@/lib/auth/passwordSetupAuth.server");
    const { getRequestBearerUserId } = await import("@/lib/auth/requestAuth.server");

    setSetPasswordIntent({ authId: "11111111-1111-1111-1111-111111111111" });
    vi.mocked(readPasswordSetupAuthorization).mockResolvedValue(null);
    vi.mocked(isPasswordSetupAuthorizationActive).mockReturnValue(false);
    vi.mocked(getRequestBearerUserId).mockResolvedValue("user-1");

    const { resolveSetPasswordContextFromCookie } = await import("@/lib/auth/passwordSetupContext.server");
    const context = await resolveSetPasswordContextFromCookie();
    expect(context).toEqual({ ok: false, redirect: "/login" });
    expect(cookieStore.has("famy_set_password_auth")).toBe(false);
  });

  it("redirects to login when bearer user does not match authorization user", async () => {
    const { setSetPasswordIntent } = await import("../authIntent.server");
    const { readPasswordSetupAuthorization, isPasswordSetupAuthorizationActive } = await import("@/lib/auth/passwordSetupAuth.server");
    const { getRequestBearerUserId } = await import("@/lib/auth/requestAuth.server");

    setSetPasswordIntent({ authId: "11111111-1111-1111-1111-111111111111" });
    vi.mocked(readPasswordSetupAuthorization).mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      user_id: "authorized-user",
      phone: "+201221000633",
      purpose: "SIGNUP",
      signup_role: "customer",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      consumed_at: null,
    });
    vi.mocked(isPasswordSetupAuthorizationActive).mockReturnValue(true);
    vi.mocked(getRequestBearerUserId).mockResolvedValue("different-user");

    const { resolveSetPasswordContextFromCookie } = await import("@/lib/auth/passwordSetupContext.server");
    const context = await resolveSetPasswordContextFromCookie();
    expect(context).toEqual({ ok: false, redirect: "/login" });
    expect(cookieStore.has("famy_set_password_auth")).toBe(false);
  });
});
