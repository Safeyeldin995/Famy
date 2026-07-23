import { randomInt } from "crypto";
import { hashOtpForPgcrypto } from "./bcryptHashForPgcrypto";
import { OtpDeliveryError } from "./OtpDeliveryError";
import type { OTPProvider } from "./OtpProvider";
import type {
  DbOtpPurpose,
  GenerateOtpResult,
  OtpVerifyError,
  VerifyOtpCoreResult,
} from "./types";

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const PHONE_RATE_LIMIT = 3;
const PHONE_RATE_WINDOW_MS = 15 * 60 * 1000;
const IP_RATE_LIMIT = 20;
const IP_RATE_WINDOW_MS = 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;
const MAX_SEND_RETRIES = 3;

export type BeginSendResult =
  | "ok"
  | "rate_limited_phone"
  | "rate_limited_ip"
  | "conflict";

export type OtpVerificationStore = {
  beginSend(params: {
    phone: string;
    purpose: DbOtpPurpose;
    ipAddress: string | null;
    userAgent: string | null;
    requestId: string;
    otpHash: string;
    expiresAtIso: string;
  }): Promise<BeginSendResult>;
  verifyAndConsume(phone: string, purpose: DbOtpPurpose, code: string): Promise<OtpVerifyError | "ok">;
  abortUndeliveredOtp(params: { phone: string; purpose: DbOtpPurpose; requestId: string }): Promise<void>;
  deleteExpired(beforeIso: string): Promise<number>;
};

export type OtpCoreServiceDeps = {
  store: OtpVerificationStore;
  provider: OTPProvider;
  now?: () => Date;
  randomDigits?: () => string;
  onOtpGenerated?: (phone: string, purpose: DbOtpPurpose, otp: string) => void;
};

function defaultRandomDigits(): string {
  return String(randomInt(0, 1_000_000)).padStart(OTP_LENGTH, "0");
}

export class OtpCoreService {
  private readonly store: OtpVerificationStore;
  private readonly provider: OTPProvider;
  private readonly now: () => Date;
  private readonly randomDigits: () => string;
  private readonly onOtpGenerated?: OtpCoreServiceDeps["onOtpGenerated"];

  constructor(deps: OtpCoreServiceDeps) {
    this.store = deps.store;
    this.provider = deps.provider;
    this.now = deps.now ?? (() => new Date());
    this.randomDigits = deps.randomDigits ?? defaultRandomDigits;
    this.onOtpGenerated = deps.onOtpGenerated;
  }

  async generateOTP(params: {
    phone: string;
    purpose: DbOtpPurpose;
    ipAddress?: string | null;
    userAgent?: string | null;
    requestId?: string;
  }): Promise<GenerateOtpResult> {
    const now = this.now();
    const plaintext = this.randomDigits();
    const otpHash = await hashOtpForPgcrypto(plaintext, BCRYPT_ROUNDS);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
    const requestId = params.requestId ?? crypto.randomUUID();

    let beginResult: BeginSendResult = "conflict";
    for (let attempt = 0; attempt < MAX_SEND_RETRIES; attempt++) {
      beginResult = await this.store.beginSend({
        phone: params.phone,
        purpose: params.purpose,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        requestId,
        otpHash,
        expiresAtIso: expiresAt.toISOString(),
      });
      if (beginResult !== "conflict") break;
    }

    if (beginResult === "rate_limited_phone") {
      return { ok: false, error: "rate_limited_phone", retryAfter: PHONE_RATE_WINDOW_MS / 1000 };
    }
    if (beginResult === "rate_limited_ip") {
      return { ok: false, error: "rate_limited_ip", retryAfter: IP_RATE_WINDOW_MS / 1000 };
    }
    if (beginResult !== "ok") {
      throw new Error(`otp_begin_send failed: ${beginResult}`);
    }

    this.onOtpGenerated?.(params.phone, params.purpose, plaintext);

    const message = `Your Famy verification code is ${plaintext}. It expires in 5 minutes.`;
    try {
      await this.provider.sendOTP(params.phone, message, {
        purpose: params.purpose,
        otp: plaintext,
        timestamp: now,
        requestId,
      });
    } catch (error) {
      await this.store.abortUndeliveredOtp({
        phone: params.phone,
        purpose: params.purpose,
        requestId,
      });
      if (error instanceof OtpDeliveryError) {
        return { ok: false, error: error.clientError };
      }
      return { ok: false, error: "temporarily_unavailable" };
    }

    return { ok: true, requestId, retryAfter: 30 };
  }

  async verifyOTP(params: {
    phone: string;
    purpose: DbOtpPurpose;
    code: string;
  }): Promise<VerifyOtpCoreResult> {
    const result = await this.store.verifyAndConsume(params.phone, params.purpose, params.code);
    if (result === "ok") return { ok: true };
    return { ok: false, error: result };
  }

  async invalidateOTP(_phone: string, _purpose: DbOtpPurpose): Promise<void> {
    // Superseded by otp_begin_send, which invalidates prior active rows atomically.
  }

  async cleanupExpired(): Promise<number> {
    return this.store.deleteExpired(this.now().toISOString());
  }
}

export const OTP_CONSTANTS = {
  OTP_LENGTH,
  OTP_TTL_MS,
  MAX_ATTEMPTS,
  PHONE_RATE_LIMIT,
  PHONE_RATE_WINDOW_MS,
  IP_RATE_LIMIT,
  IP_RATE_WINDOW_MS,
} as const;
