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
      handler: (handlerFn: (ctx: { data: { idToken: string } }) => unknown) => typeof handlerFn;
    } = {
      inputValidator: () => builder,
      handler: (handlerFn) => handlerFn,
    };
    return builder;
  },
}));

const isFirebaseOtpProvider = vi.fn();
vi.mock("@/lib/otp/otpProviderKind.server", () => ({
  isFirebaseOtpProvider: () => isFirebaseOtpProvider(),
}));

const verifyFirebasePhoneIdToken = vi.fn();
vi.mock("@/lib/otp/firebaseAdmin.server", () => ({
  verifyFirebasePhoneIdToken: (...args: unknown[]) => verifyFirebasePhoneIdToken(...args),
}));

const listUsers = vi.fn();
const createUser = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        listUsers: (...args: unknown[]) => listUsers(...args),
        createUser: (...args: unknown[]) => createUser(...args),
        deleteUser: vi.fn(),
      },
    },
    from: (...args: unknown[]) => from(...args),
  },
}));

const signInWithPassword = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { signInWithPassword: (...args: unknown[]) => signInWithPassword(...args) },
  })),
}));

const createPasswordSetupAuthorization = vi.fn();
vi.mock("@/lib/auth/passwordSetupAuth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/passwordSetupAuth.server")>();
  return {
    ...actual,
    createPasswordSetupAuthorization: (...args: unknown[]) =>
      createPasswordSetupAuthorization(...args),
  };
});

describe("verifyFirebaseOtpFn", () => {
  beforeEach(async () => {
    vi.resetModules();
    cookieStore.clear();
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    isFirebaseOtpProvider.mockReturnValue(true);
    verifyFirebasePhoneIdToken.mockResolvedValue({
      ok: true,
      phoneE164: "+201012345678",
      decoded: { uid: "firebase-user-1" },
    });
    listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    createUser.mockResolvedValue({
      data: { user: { id: "11111111-1111-1111-1111-111111111111" } },
      error: null,
    });
    from.mockImplementation((table: string) => {
      if (table === "user_roles") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ role: "customer" }], error: null }),
          }),
        };
      }
      return {
        insert: () => Promise.resolve({ error: null }),
      };
    });
    signInWithPassword.mockResolvedValue({
      data: {
        session: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      },
      error: null,
    });
    createPasswordSetupAuthorization.mockResolvedValue("22222222-2222-2222-2222-222222222222");
  });

  afterEach(() => {
    delete process.env.AUTH_INTENT_SECRET;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    vi.clearAllMocks();
  });

  async function seedPendingIntent() {
    const { setOtpPendingIntent } = await import("@/lib/auth/authIntent.server");
    setOtpPendingIntent({
      phone: "+201012345678",
      purpose: "signup",
      role: "customer",
      retryAfterSeconds: 300,
    });
  }

  it("rejects when the server OTP provider is not firebase", async () => {
    isFirebaseOtpProvider.mockReturnValue(false);
    await seedPendingIntent();
    const { verifyFirebaseOtpFn } = await import("@/lib/otp.functions");
    const result = await verifyFirebaseOtpFn({ data: { idToken: "firebase-id-token" } });
    expect(result).toEqual({ ok: false, error: "invalid_code" });
  });

  it("rejects when the signed OTP pending cookie is missing", async () => {
    const { verifyFirebaseOtpFn } = await import("@/lib/otp.functions");
    const result = await verifyFirebaseOtpFn({ data: { idToken: "firebase-id-token" } });
    expect(result).toEqual({ ok: false, error: "invalid_code" });
    expect(verifyFirebasePhoneIdToken).not.toHaveBeenCalled();
  });

  it("rejects when the signed OTP pending intent is expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T12:00:00.000Z"));
    await seedPendingIntent();
    vi.setSystemTime(new Date("2026-07-22T12:05:01.000Z"));

    const { verifyFirebaseOtpFn } = await import("@/lib/otp.functions");
    const { readOtpPendingIntent: readPending } = await import("@/lib/auth/authIntent.server");
    const result = await verifyFirebaseOtpFn({ data: { idToken: "firebase-id-token" } });

    expect(result).toEqual({ ok: false, error: "invalid_code" });
    expect(readPending()).toBeNull();
    expect(verifyFirebasePhoneIdToken).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("rejects when Firebase token verification fails", async () => {
    await seedPendingIntent();
    verifyFirebasePhoneIdToken.mockResolvedValue({ ok: false, error: "phone_mismatch" });
    const { verifyFirebaseOtpFn } = await import("@/lib/otp.functions");
    const result = await verifyFirebaseOtpFn({ data: { idToken: "firebase-id-token" } });
    expect(result).toEqual({ ok: false, error: "invalid_code" });
    expect(verifyFirebasePhoneIdToken).toHaveBeenCalledWith(
      "firebase-id-token",
      "+201012345678",
    );
  });

  it("finalizes verification and transitions to the set-password cookie", async () => {
    await seedPendingIntent();
    const { verifyFirebaseOtpFn } = await import("@/lib/otp.functions");
    const { readOtpPendingIntent, readSetPasswordIntent } = await import(
      "@/lib/auth/authIntent.server"
    );

    const result = await verifyFirebaseOtpFn({ data: { idToken: "firebase-id-token" } });

    expect(result).toEqual({
      ok: true,
      userId: "11111111-1111-1111-1111-111111111111",
      isNewUser: true,
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
    expect(readOtpPendingIntent()).toBeNull();
    expect(readSetPasswordIntent()?.authId).toBe("22222222-2222-2222-2222-222222222222");
    expect(createPasswordSetupAuthorization).toHaveBeenCalledWith({
      userId: "11111111-1111-1111-1111-111111111111",
      phone: "+201012345678",
      purpose: "SIGNUP",
      role: "customer",
    });
  });
});
