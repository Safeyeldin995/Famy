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

function retryAfterFromOldest(oldestIso: string | undefined | null): number {
  if (!oldestIso) {
    return Math.ceil(OTP_SEND_RATE_LIMIT.WINDOW_MS / 1000);
  }
  const retryAt = new Date(oldestIso).getTime() + OTP_SEND_RATE_LIMIT.WINDOW_MS;
  return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
}

async function countAttemptsSince(
  column: "phone_hash" | "ip_hash",
  hash: string,
  sinceIso: string,
): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count, error } = await supabaseAdmin
    .from("otp_send_attempts")
    .select("id", { count: "exact", head: true })
    .eq(column, hash)
    .gte("created_at", sinceIso);
  if (error) throw error;
  return count ?? 0;
}

async function oldestAttemptSince(
  column: "phone_hash" | "ip_hash",
  hash: string,
  sinceIso: string,
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("otp_send_attempts")
    .select("created_at")
    .eq(column, hash)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.created_at ?? null;
}

async function pruneStaleAttempts(phoneHash: string, ipHash: string | null): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - OTP_SEND_RATE_LIMIT.RETENTION_MS).toISOString();
  const phonePrune = supabaseAdmin
    .from("otp_send_attempts")
    .delete()
    .eq("phone_hash", phoneHash)
    .lt("created_at", cutoff);
  const tasks = [phonePrune];
  if (ipHash) {
    tasks.push(
      supabaseAdmin.from("otp_send_attempts").delete().eq("ip_hash", ipHash).lt("created_at", cutoff),
    );
  }
  const results = await Promise.all(tasks);
  for (const res of results) {
    if (res.error) throw res.error;
  }
}

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
  const sinceIso = new Date(Date.now() - OTP_SEND_RATE_LIMIT.WINDOW_MS).toISOString();

  const phoneCount = await countAttemptsSince("phone_hash", phoneHash, sinceIso);
  if (phoneCount >= OTP_SEND_RATE_LIMIT.PHONE_MAX_ATTEMPTS) {
    const oldest = await oldestAttemptSince("phone_hash", phoneHash, sinceIso);
    return { ok: false, error: "rate_limited", retryAfter: retryAfterFromOldest(oldest) };
  }

  if (ipHash) {
    const ipCount = await countAttemptsSince("ip_hash", ipHash, sinceIso);
    if (ipCount >= OTP_SEND_RATE_LIMIT.IP_MAX_ATTEMPTS) {
      const oldest = await oldestAttemptSince("ip_hash", ipHash, sinceIso);
      return { ok: false, error: "rate_limited", retryAfter: retryAfterFromOldest(oldest) };
    }
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error: insertError } = await supabaseAdmin.from("otp_send_attempts").insert({
    phone_hash: phoneHash,
    ip_hash: ipHash,
  });
  if (insertError) throw insertError;

  await pruneStaleAttempts(phoneHash, ipHash);
  return { ok: true };
}
