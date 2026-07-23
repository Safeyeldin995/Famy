export type DbOtpPurpose = "LOGIN" | "SIGNUP" | "RESET_PASSWORD";
export type AppOtpPurpose = "signup" | "reset";

export function toDbOtpPurpose(purpose: AppOtpPurpose): DbOtpPurpose {
  return purpose === "signup" ? "SIGNUP" : "RESET_PASSWORD";
}

export type OtpVerificationRow = {
  id: string;
  phone: string;
  purpose: DbOtpPurpose;
  otp_hash: string;
  expires_at: string;
  attempts: number;
  used_at: string | null;
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
};

export type GenerateOtpResult =
  | { ok: true; requestId: string; retryAfter?: number }
  | {
      ok: false;
      error: "rate_limited_phone" | "rate_limited_ip" | "delivery_failed" | "temporarily_unavailable";
      retryAfter?: number;
    };

export type VerifyOtpCoreResult =
  | { ok: true }
  | { ok: false; error: OtpVerifyError };

export type OtpVerifyError = "invalid_code" | "expired" | "max_attempts" | "not_found" | "already_used";
