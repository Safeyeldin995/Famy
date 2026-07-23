import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { OtpCoreService, OTP_CONSTANTS, type BeginSendResult, type OtpVerificationStore } from "../OtpCoreService";
import type { DbOtpPurpose, OtpVerificationRow } from "../types";
import type { OTPProvider } from "../OtpProvider";
import { MockOTPProvider } from "../MockOTPProvider.server";

function createAtomicMemoryStore(now: () => Date): OtpVerificationStore {
  const rows: OtpVerificationRow[] = [];
  let chain = Promise.resolve();

  const withLock = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    const run = chain.then(fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };

  return {
    async beginSend(params) {
      return withLock(async (): Promise<BeginSendResult> => {
        const phoneSince = new Date(now().getTime() - OTP_CONSTANTS.PHONE_RATE_WINDOW_MS).toISOString();
        if (rows.filter((r) => r.phone === params.phone && r.created_at >= phoneSince).length >= OTP_CONSTANTS.PHONE_RATE_LIMIT) {
          return "rate_limited_phone";
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
        const row = rows.find((r) => r.phone === phone && r.purpose === purpose && !r.used_at);
        if (!row) return "not_found";
        if (await bcrypt.compare(code, row.otp_hash)) {
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

function createService(randomDigits: () => string = () => "123456") {
  const now = () => new Date("2026-07-22T12:00:00.000Z");
  const provider: OTPProvider = new MockOTPProvider();
  const service = new OtpCoreService({
    store: createAtomicMemoryStore(now),
    provider,
    now,
    randomDigits,
  });
  return { service, provider };
}

const phone = "+201012345678";
const purpose: DbOtpPurpose = "SIGNUP";

describe("OTP security boundaries", () => {
  it("cannot retrieve plaintext OTP from MockOTPProvider", () => {
    const provider = new MockOTPProvider();
    expect(provider).not.toHaveProperty("getLatestCode");
    expect(provider).not.toHaveProperty("clearLatestCode");
  });

  it("verifyOTP fails when no OTP was issued", async () => {
    const { service } = createService();
    const result = await service.verifyOTP({ phone, purpose, code: "123456" });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("verifyOTP rejects an arbitrary caller-supplied OTP", async () => {
    const { service } = createService();
    await service.generateOTP({ phone, purpose });
    const result = await service.verifyOTP({ phone, purpose, code: "999999" });
    expect(result).toEqual({ ok: false, error: "invalid_code" });
  });

  it("signup cannot complete without the correct caller-supplied OTP", async () => {
    const { service } = createService();
    await service.generateOTP({ phone, purpose: "SIGNUP" });
    const wrong = await service.verifyOTP({ phone, purpose: "SIGNUP", code: "000000" });
    expect(wrong.ok).toBe(false);
    const correct = await service.verifyOTP({ phone, purpose: "SIGNUP", code: "123456" });
    expect(correct).toEqual({ ok: true });
  });

  it("password reset cannot complete without the correct caller-supplied OTP", async () => {
    const { service } = createService();
    await service.generateOTP({ phone, purpose: "RESET_PASSWORD" });
    const wrong = await service.verifyOTP({ phone, purpose: "RESET_PASSWORD", code: "111111" });
    expect(wrong.ok).toBe(false);
    const correct = await service.verifyOTP({ phone, purpose: "RESET_PASSWORD", code: "123456" });
    expect(correct).toEqual({ ok: true });
  });

  it("OtpCoreService has no internal OTP retrieval method", () => {
    const { service } = createService();
    for (const method of ["getLatestCode", "getLastOtp", "peekOtp", "verifyLatestOtp", "verifyWithoutCode"]) {
      expect(method in service).toBe(false);
    }
  });
});
