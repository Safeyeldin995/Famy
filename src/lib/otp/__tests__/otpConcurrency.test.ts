import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { OtpCoreService, OTP_CONSTANTS, type BeginSendResult, type OtpVerificationStore } from "../OtpCoreService";
import type { DbOtpPurpose, OtpVerificationRow } from "../types";
import type { OTPProvider } from "../OtpProvider";

/** Mutex-backed store mirroring otp_begin_send / otp_verify_and_consume semantics. */
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
        if (rows.filter((r) => r.phone === params.phone && r.created_at >= phoneSince).length >= OTP_CONSTANTS.PHONE_RATE_LIMIT) {
          return "rate_limited_phone";
        }
        if (params.ipAddress) {
          const ipSince = new Date(now().getTime() - OTP_CONSTANTS.IP_RATE_WINDOW_MS).toISOString();
          if (rows.filter((r) => r.ip_address === params.ipAddress && r.created_at >= ipSince).length >= OTP_CONSTANTS.IP_RATE_LIMIT) {
            return "rate_limited_ip";
          }
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
        if (await bcrypt.compare(code, row.otp_hash)) {
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
      const idx = rows.findIndex(
        (r) =>
          r.phone === params.phone &&
          r.purpose === params.purpose &&
          r.request_id === params.requestId &&
          !r.used_at,
      );
      if (idx >= 0) rows.splice(idx, 1);
    },

    async deleteExpired() {
      return 0;
    },
  };
}

const noopProvider: OTPProvider = { async sendOTP() {} };

const phone = "+201012345678";
const purpose: DbOtpPurpose = "SIGNUP";

describe("OTP concurrency", () => {
  it("allows only one concurrent correct verify to succeed", async () => {
    const now = () => new Date("2026-07-22T12:00:00.000Z");
    const store = createAtomicMemoryStore(now);
    const service = new OtpCoreService({ store, provider: noopProvider, now, randomDigits: () => "123456" });
    await service.generateOTP({ phone, purpose });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.verifyOTP({ phone, purpose, code: "123456" })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(4);
  });

  it("preserves attempt count under concurrent invalid verifies", async () => {
    const now = () => new Date("2026-07-22T12:00:00.000Z");
    const store = createAtomicMemoryStore(now);
    const service = new OtpCoreService({ store, provider: noopProvider, now, randomDigits: () => "123456" });
    await service.generateOTP({ phone, purpose });

    await Promise.all(
      Array.from({ length: 5 }, () => service.verifyOTP({ phone, purpose, code: "000000" })),
    );

    const row = store.rows.find((r) => r.phone === phone);
    expect(row?.attempts).toBe(5);
    expect(row?.used_at).not.toBeNull();
  });

  it("enforces phone rate limits under concurrent sendOtp", async () => {
    const now = () => new Date("2026-07-22T12:00:00.000Z");
    const store = createAtomicMemoryStore(now);
    const service = new OtpCoreService({ store, provider: noopProvider, now, randomDigits: () => "123456" });

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => service.generateOTP({ phone, purpose, ipAddress: `10.0.0.${i}` })),
    );

    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(OTP_CONSTANTS.PHONE_RATE_LIMIT);
    expect(results.some((r) => !r.ok && r.error === "rate_limited_phone")).toBe(true);
  });

  it("invalidates old OTP immediately after resend", async () => {
    const now = () => new Date("2026-07-22T12:00:00.000Z");
    const store = createAtomicMemoryStore(now);
    const service = new OtpCoreService({
      store,
      provider: noopProvider,
      now,
      randomDigits: () => "123456",
    });
    await service.generateOTP({ phone, purpose });
    await service.generateOTP({ phone, purpose });

    const stale = await service.verifyOTP({ phone, purpose, code: "123456" });
    expect(stale.ok).toBe(true);

    const replay = await service.verifyOTP({ phone, purpose, code: "123456" });
    expect(replay.ok).toBe(false);
  });
});
