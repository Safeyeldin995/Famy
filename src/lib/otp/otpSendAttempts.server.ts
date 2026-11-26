import { createHash } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";
import { OTP_SEND_RATE_LIMIT } from "@/lib/otp/otpSendRateLimit.constants";

export type OtpSendAttemptResult =
  | { ok: true }
  | { ok: false; error: "rate_limited"; retryAfter: number };

function otpSendAttemptSalt(): string {
  const salt = process.env.AUTH_INTENT_SECRET;
  if (!salt) {
    throw new Error("AUTH_INTENT_SECRET is not configured");
  }
  return salt;
}

export function hashOtpSendAttemptValue(raw: string): string {
  return createHash("sha256")
    .update(`${otpSendAttemptSalt()}:${raw}`)
    .digest("hex");
}

/** Client IP for pre-send rate limits (Vercel: first `x-forwarded-for`, else `x-real-ip`). */
export function requestClientIpForOtpSend(): string | null {
  const request = getRequest();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return null;
}

type OtpSendRpcResult = {
  allowed: boolean;
  retry_after_seconds?: number;
};

/**
 * Records one send/begin/resend attempt when under limits.
 * Must run before flow-mismatch checks to avoid account enumeration.
 */
export async function recordOtpSendAttemptIfAllowed(params: {
  phoneE164: string;
  ipAddress: string | null;
}): Promise<OtpSendAttemptResult> {
  const phoneHash = hashOtpSendAttemptValue(params.phoneE164);
  const ipHash = params.ipAddress ? hashOtpSendAttemptValue(params.ipAddress) : null;
  const windowSeconds = Math.ceil(OTP_SEND_RATE_LIMIT.WINDOW_MS / 1000);
  const retentionSeconds = Math.ceil(OTP_SEND_RATE_LIMIT.RETENTION_MS / 1000);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (
    supabaseAdmin as never as { rpc: (name: string, args: object) => ReturnType<typeof supabaseAdmin.rpc> }
  ).rpc("otp_send_attempt_record_if_allowed", {
    p_phone_hash: phoneHash,
    p_ip_hash: ipHash,
    p_phone_limit: OTP_SEND_RATE_LIMIT.PHONE_MAX_ATTEMPTS,
    p_ip_limit: OTP_SEND_RATE_LIMIT.IP_MAX_ATTEMPTS,
    p_window_seconds: windowSeconds,
    p_retention_seconds: retentionSeconds,
  });
  if (error) throw error;
  const parsed = data as OtpSendRpcResult | null;
  if (!parsed?.allowed) {
    return {
      ok: false,
      error: "rate_limited",
      retryAfter: Math.max(1, Number(parsed?.retry_after_seconds ?? windowSeconds)),
    };
  }
  return { ok: true };
}
