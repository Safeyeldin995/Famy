import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { OtpCoreService, OTP_CONSTANTS, type BeginSendResult, type OtpVerificationStore } from "../OtpCoreService";
import type { DbOtpPurpose, OtpVerificationRow } from "../types";
import type { OTPProvider } from "../OtpProvider";

function createAtomicMemoryStore(now: () => Date): OtpVerificationStore & { rows: OtpVerificationRow[] } {
  const rows: OtpVerificationRow[] = [];
  let chain = Promise.resolve();

  const withLock = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    const run = chain.then(fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };

  return {
    rows,
    async beginSend(params) {
      return withLock(async (): Promise<BeginSendResult> => {
        const phoneSince = new Date(now().getTime() - OTP_CONSTANTS.PHONE_RATE_WINDOW_MS).toISOString();
        const phoneCount = rows.filter(
          (r) => r.phone === params.phone && r.created_at >= phoneSince,
        ).length;
        if (phoneCount >= OTP_CONSTANTS.PHONE_RATE_LIMIT) return "rate_limited_phone";

        if (params.ipAddress) {
          const ipSince = new Date(now().getTime() - OTP_CONSTANTS.IP_RATE_WINDOW_MS).toISOString();
          const ipCount = rows.filter(
            (r) => r.ip_address === params.ipAddress && r.created_at >= ipSince,
          ).length;
          if (ipCount >= OTP_CONSTANTS.IP_RATE_LIMIT) return "rate_limited_ip";
        }

        for (const row of rows) {
          if (row.phone === params.phone && row.purpose === params.purpose && !row.used_at) {
            row.used_at = now().toISOString();
          }
        }

        rows.push({
          id: crypto.randomUUID(),
          phone: params.phone,
          purpose: params.purpose,
          otp_hash: params.otpHash,
          expires_at: params.expiresAtIso,
          attempts: 0,
          used_at: null,
          created_at: now().toISOString(),
          ip_address: params.ipAddress,
          user_agent: params.userAgent,
          request_id: params.requestId,
        });
        return "ok";
      });
    },

    async verifyAndConsume(phone, purpose, code) {
      return withLock(async () => {
        const row = rows
          .filter((r) => r.phone === phone && r.purpose === purpose && !r.used_at)
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0];
        if (!row) return "not_found";
        if (new Date(row.expires_at).getTime() <= now().getTime()) {
          row.used_at = now().toISOString();
          return "expired";
        }
        if (row.attempts >= OTP_CONSTANTS.MAX_ATTEMPTS) {
          row.used_at = now().toISOString();
          return "max_attempts";
        }
        const matches = await bcrypt.compare(code, row.otp_hash);
        if (matches) {
          if (row.used_at) return "already_used";
          row.used_at = now().toISOString();
          return "ok";
        }
        row.attempts += 1;
        if (row.attempts >= OTP_CONSTANTS.MAX_ATTEMPTS) {
          row.used_at = now().toISOString();
          return "max_attempts";
        }
        return "invalid_code";
      });
    },

    async abortUndeliveredOtp(params) {
      return withLock(async () => {
        const idx = rows.findIndex(
          (r) =>
            r.phone === params.phone &&
            r.purpose === params.purpose &&
            r.request_id === params.requestId &&
            !r.used_at,
        );
        if (idx >= 0) rows.splice(idx, 1);
      });
    },

    async deleteExpired(beforeIso) {
      const before = new Date(beforeIso).getTime();
      const remaining = rows.filter((r) => new Date(r.expires_at).getTime() >= before);
      const deleted = rows.length - remaining.length;
      rows.length = 0;
      rows.push(...remaining);
      return deleted;
    },
  };
}

function createTestProvider(): OTPProvider & { lastOtp?: string } {
  const state = { lastOtp: undefined as string | undefined };
  return {
    async sendOTP(_phone, _message, meta) {
      state.lastOtp = meta.otp;
    },
    get lastOtp() {
      return state.lastOtp;
    },
  };
}

function createService(overrides?: {
  now?: () => Date;
  randomDigits?: () => string;
}) {
  const baseNow = overrides?.now?.() ?? new Date("2026-07-22T12:00:00.000Z");
  let current = new Date(baseNow);
  const now = overrides?.now ?? (() => current);
  const store = createAtomicMemoryStore(now);
  const provider = createTestProvider();
  const service = new OtpCoreService({
    store,
    provider,
    now,
    randomDigits: overrides?.randomDigits ?? (() => "123456"),
  });
  return { service, store, provider, advance: (ms: number) => { current = new Date(current.getTime() + ms); } };
}

const phone = "+201012345678";
const purpose: DbOtpPurpose = "SIGNUP";

describe("OtpCoreService", () => {
  it("hashes OTP and verifies the correct code", async () => {
    const { service, provider } = createService();
    const generated = await service.generateOTP({ phone, purpose, ipAddress: "1.2.3.4" });
    expect(generated.ok).toBe(true);
    expect(provider.lastOtp).toBe("123456");

    const verified = await service.verifyOTP({ phone, purpose, code: "123456" });
    expect(verified).toEqual({ ok: true });
  });

  it("rejects an incorrect code", async () => {
    const { service } = createService();
    await service.generateOTP({ phone, purpose });
    const verified = await service.verifyOTP({ phone, purpose, code: "999999" });
    expect(verified).toEqual({ ok: false, error: "invalid_code" });
  });

  it("expires OTP after 5 minutes", async () => {
    const { service, advance } = createService();
    await service.generateOTP({ phone, purpose });
    advance(OTP_CONSTANTS.OTP_TTL_MS + 1);
    const verified = await service.verifyOTP({ phone, purpose, code: "123456" });
    expect(verified).toEqual({ ok: false, error: "expired" });
  });

  it("invalidates OTP after 5 failed attempts", async () => {
    const { service } = createService();
    await service.generateOTP({ phone, purpose });
    for (let i = 0; i < 4; i++) {
      const attempt = await service.verifyOTP({ phone, purpose, code: "000000" });
      expect(attempt).toEqual({ ok: false, error: "invalid_code" });
    }
    const finalAttempt = await service.verifyOTP({ phone, purpose, code: "000000" });
    expect(finalAttempt).toEqual({ ok: false, error: "max_attempts" });
    const replay = await service.verifyOTP({ phone, purpose, code: "123456" });
    expect(replay.ok).toBe(false);
  });

  it("prevents replay after successful verification", async () => {
    const { service } = createService();
    await service.generateOTP({ phone, purpose });
    const first = await service.verifyOTP({ phone, purpose, code: "123456" });
    expect(first).toEqual({ ok: true });
    const replay = await service.verifyOTP({ phone, purpose, code: "123456" });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error).toBe("not_found");
  });

  it("rate limits OTP generation per phone", async () => {
    const { service } = createService();
    for (let i = 0; i < OTP_CONSTANTS.PHONE_RATE_LIMIT; i++) {
      const res = await service.generateOTP({ phone, purpose, ipAddress: `10.0.0.${i}` });
      expect(res.ok).toBe(true);
    }
    const limited = await service.generateOTP({ phone, purpose, ipAddress: "10.0.0.99" });
    expect(limited).toEqual({
      ok: false,
      error: "rate_limited_phone",
      retryAfter: OTP_CONSTANTS.PHONE_RATE_WINDOW_MS / 1000,
    });
  });

  it("rate limits OTP generation per IP", async () => {
    const { service } = createService();
    const ip = "203.0.113.10";
    for (let i = 0; i < OTP_CONSTANTS.IP_RATE_LIMIT; i++) {
      const res = await service.generateOTP({
        phone: `+2010000000${String(i).padStart(2, "0")}`,
        purpose,
        ipAddress: ip,
      });
      expect(res.ok).toBe(true);
    }
    const limited = await service.generateOTP({
      phone: "+201099999999",
      purpose,
      ipAddress: ip,
    });
    expect(limited).toEqual({
      ok: false,
      error: "rate_limited_ip",
      retryAfter: OTP_CONSTANTS.IP_RATE_WINDOW_MS / 1000,
    });
  });

  it("never stores plaintext OTP in the repository", async () => {
    const { service, store } = createService();
    await service.generateOTP({ phone, purpose });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].otp_hash).not.toBe("123456");
    expect(await bcrypt.compare("123456", store.rows[0].otp_hash)).toBe(true);
  });

  it("cleanupExpired removes expired rows", async () => {
    const { service, store, advance } = createService();
    await service.generateOTP({ phone, purpose });
    advance(OTP_CONSTANTS.OTP_TTL_MS + 1);
    const removed = await service.cleanupExpired();
    expect(removed).toBe(1);
    expect(store.rows).toHaveLength(0);
  });

  it("resend invalidates the previous OTP", async () => {
    let call = 0;
    const { service } = createService({
      randomDigits: () => (call++ === 0 ? "111111" : "222222"),
    });
    await service.generateOTP({ phone, purpose });
    await service.generateOTP({ phone, purpose });
    const oldCode = await service.verifyOTP({ phone, purpose, code: "111111" });
    expect(oldCode.ok).toBe(false);
    const newCode = await service.verifyOTP({ phone, purpose, code: "222222" });
    expect(newCode).toEqual({ ok: true });
  });
});
