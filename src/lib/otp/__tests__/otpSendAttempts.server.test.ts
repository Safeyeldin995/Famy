import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => [] as { phone_hash: string; ip_hash: string | null; created_at: string }[]);

const rpcMock = vi.hoisted(() =>
  vi.fn(async (_name: string, args: Record<string, unknown>) => {
    const windowSeconds = Number(args.p_window_seconds) || 3600;
    const since = Date.now() - windowSeconds * 1000;
    const phoneHash = String(args.p_phone_hash);
    const ipHash = args.p_ip_hash ? String(args.p_ip_hash) : null;
    const phoneCount = rows.filter(
      (r) => r.phone_hash === phoneHash && new Date(r.created_at).getTime() >= since,
    ).length;
    if (phoneCount >= Number(args.p_phone_limit)) {
      return { data: { allowed: false, retry_after_seconds: 60 }, error: null };
    }
    if (ipHash) {
      const ipCount = rows.filter(
        (r) => r.ip_hash === ipHash && new Date(r.created_at).getTime() >= since,
      ).length;
      if (ipCount >= Number(args.p_ip_limit)) {
        return { data: { allowed: false, retry_after_seconds: 60 }, error: null };
      }
    }
    rows.push({ phone_hash: phoneHash, ip_hash: ipHash, created_at: new Date().toISOString() });
    return { data: { allowed: true }, error: null };
  }),
);

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: rpcMock },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({
    headers: new Headers({ "x-forwarded-for": "203.0.113.10, 198.51.100.2" }),
  }),
}));

describe("recordOtpSendAttemptIfAllowed", () => {
  beforeEach(() => {
    rows.length = 0;
    process.env.AUTH_INTENT_SECRET = "test-auth-intent-secret";
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.AUTH_INTENT_SECRET;
  });

  it("blocks the 6th phone attempt within the window", async () => {
    const { recordOtpSendAttemptIfAllowed } = await import("@/lib/otp/otpSendAttempts.server");
    const phone = "+201055512345";
    for (let i = 0; i < 5; i += 1) {
      const res = await recordOtpSendAttemptIfAllowed({ phoneE164: phone, ipAddress: null });
      expect(res.ok).toBe(true);
    }
    const blocked = await recordOtpSendAttemptIfAllowed({ phoneE164: phone, ipAddress: null });
    expect(blocked).toMatchObject({ ok: false, error: "rate_limited" });
    expect((blocked as { retryAfter?: number }).retryAfter).toBeGreaterThan(0);
    expect(rows).toHaveLength(5);
  });

  it("blocks the 11th IP attempt within the window", async () => {
    const { recordOtpSendAttemptIfAllowed } = await import("@/lib/otp/otpSendAttempts.server");
    for (let i = 0; i < 10; i += 1) {
      const res = await recordOtpSendAttemptIfAllowed({
        phoneE164: `+2010555000${String(i).padStart(2, "0")}`,
        ipAddress: "203.0.113.10",
      });
      expect(res.ok).toBe(true);
    }
    const blocked = await recordOtpSendAttemptIfAllowed({
      phoneE164: "+201099988877",
      ipAddress: "203.0.113.10",
    });
    expect(blocked).toMatchObject({ ok: false, error: "rate_limited" });
  });

  it("stores salted hashes only, never raw phone or IP", async () => {
    const { recordOtpSendAttemptIfAllowed, hashOtpSendAttemptValue } = await import(
      "@/lib/otp/otpSendAttempts.server"
    );
    const phone = "+201012345678";
    const ip = "203.0.113.10";
    await recordOtpSendAttemptIfAllowed({ phoneE164: phone, ipAddress: ip });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.phone_hash).toBe(hashOtpSendAttemptValue(phone));
    expect(row.ip_hash).toBe(hashOtpSendAttemptValue(ip));
    expect(row.phone_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.phone_hash).not.toContain("2010");
    expect(row.ip_hash).not.toContain("203.0.113");
    expect(rpcMock).toHaveBeenCalledWith(
      "otp_send_attempt_record_if_allowed",
      expect.objectContaining({
        p_phone_hash: row.phone_hash,
        p_ip_hash: row.ip_hash,
      }),
    );
  });
});