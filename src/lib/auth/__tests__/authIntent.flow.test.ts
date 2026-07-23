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

describe("auth intent cookies", () => {
  beforeEach(() => {
    cookieStore.clear();
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
  });

  afterEach(() => {
    delete process.env.AUTH_INTENT_SECRET;
  });

  it("stores and reads a pending OTP intent with masked-safe fields only", async () => {
    const {
      setOtpPendingIntent,
      readOtpPendingIntent,
      maskPhoneE164,
    } = await import("../authIntent.server");

    setOtpPendingIntent({
      phone: "+201221000633",
      purpose: "signup",
      role: "customer",
      retryAfterSeconds: 30,
    });

    const pending = readOtpPendingIntent();
    expect(pending).not.toBeNull();
    expect(pending?.phone).toBe("+201221000633");
    expect(pending?.purpose).toBe("signup");
    expect(pending?.role).toBe("customer");
    expect(maskPhoneE164(pending!.phone)).toBe("+20 *** *** 0633");
    expect(pending!.otpExp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("stores only the authorization id in the set-password cookie", async () => {
    const { setSetPasswordIntent, readSetPasswordIntent } = await import("../authIntent.server");

    setSetPasswordIntent({ authId: "11111111-1111-1111-1111-111111111111" });
    const intent = readSetPasswordIntent();
    expect(intent?.authId).toBe("11111111-1111-1111-1111-111111111111");
    expect(intent).not.toHaveProperty("phone");
    expect(intent).not.toHaveProperty("purpose");
  });

  it("rejects tampered OTP pending cookies", async () => {
    const { setOtpPendingIntent, readOtpPendingIntent } = await import("../authIntent.server");

    setOtpPendingIntent({
      phone: "+201221000633",
      purpose: "signup",
      retryAfterSeconds: 30,
    });

    const raw = cookieStore.get("famy_otp_pending")!;
    cookieStore.set("famy_otp_pending", `${raw.slice(0, -1)}x`);
    expect(readOtpPendingIntent()).toBeNull();
  });

  it("clears set-password cookie on consume", async () => {
    const {
      setSetPasswordIntent,
      readSetPasswordIntent,
      consumeSetPasswordIntent,
    } = await import("../authIntent.server");

    setSetPasswordIntent({ authId: "11111111-1111-1111-1111-111111111111" });
    expect(readSetPasswordIntent()?.authId).toBe("11111111-1111-1111-1111-111111111111");
    const first = consumeSetPasswordIntent();
    expect(first?.authId).toBe("11111111-1111-1111-1111-111111111111");
    expect(readSetPasswordIntent()).toBeNull();
    expect(consumeSetPasswordIntent()).toBeNull();
  });

  it("expires OTP pending intent after ttl", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T12:00:00.000Z"));
    const { setOtpPendingIntent, readOtpPendingIntent } = await import("../authIntent.server");

    setOtpPendingIntent({
      phone: "+201221000633",
      purpose: "signup",
      retryAfterSeconds: 30,
    });

    vi.setSystemTime(new Date("2026-07-22T12:05:01.000Z"));
    expect(readOtpPendingIntent()).toBeNull();
    vi.useRealTimers();
  });
});

function resolveOtpScreenContext(
  pending: {
    phone: string;
    purpose: "signup" | "reset";
    role?: "customer" | "provider";
    otpExp: number;
    resendAt: number;
  } | null,
  now: number,
) {
  if (!pending) return { ok: false as const, redirect: "/login" as const };
  if (pending.otpExp <= now) {
    return { ok: false as const, redirect: pending.purpose === "reset" ? "/auth/forgot" as const : "/login" as const };
  }
  return {
    ok: true as const,
    maskedPhone: "+20 *** *** 0633",
    purpose: pending.purpose,
    role: pending.role,
    otpExpiresIn: Math.max(0, pending.otpExp - now),
    resendAvailableIn: Math.max(0, pending.resendAt - now),
  };
}

describe("otp screen context resolution", () => {
  it("redirects to login when no trusted auth intent exists", () => {
    expect(resolveOtpScreenContext(null, 1_000)).toEqual({ ok: false, redirect: "/login" });
  });

  it("redirects reset flows to forgot-password when intent expired", () => {
    const context = resolveOtpScreenContext(
      {
        phone: "+201221000633",
        purpose: "reset",
        otpExp: 100,
        resendAt: 90,
      },
      100,
    );
    expect(context).toEqual({ ok: false, redirect: "/auth/forgot" });
  });

  it("returns safe display metadata for a valid pending intent", () => {
    const context = resolveOtpScreenContext(
      {
        phone: "+201221000633",
        purpose: "signup",
        role: "customer",
        otpExp: 400,
        resendAt: 130,
      },
      100,
    );
    expect(context.ok).toBe(true);
    if (context.ok) {
      expect(context.maskedPhone).toBe("+20 *** *** 0633");
      expect(context.otpExpiresIn).toBe(300);
      expect(context.resendAvailableIn).toBe(30);
    }
  });
});

describe("set-password context resolution", () => {
  it("redirects to login when authorization is missing", () => {
    const context = { ok: false as const, redirect: "/login" as const };
    expect(context).toEqual({ ok: false, redirect: "/login" });
  });
});
