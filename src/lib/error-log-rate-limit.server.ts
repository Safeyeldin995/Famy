import { getRequest } from "@tanstack/react-start/server";

/** Matches prior in-process contract: 20 client error posts per IP per 60s window. */
export const CLIENT_ERROR_LOG_RATE_LIMIT = 20;
export const CLIENT_ERROR_LOG_RATE_WINDOW_MS = 60_000;

export function resolveClientErrorLogRateLimitKey(request: Request): string {
  const ipAddress =
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-vercel-forwarded-for")?.split(",").pop()?.trim() ??
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
    "unknown";
  return ipAddress || "unknown";
}

/**
 * Postgres-backed rate limit (Cloudflare Workers safe). Returns false when over limit
 * or when the limit check itself fails (fail closed to avoid flooding).
 */
export async function assertClientErrorLogRateLimit(): Promise<boolean> {
  const request = getRequest();
  const key = resolveClientErrorLogRateLimitKey(request);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("error_log_client_rate_limit_allow", {
      p_rate_key: key,
      p_limit: CLIENT_ERROR_LOG_RATE_LIMIT,
      p_window_seconds: CLIENT_ERROR_LOG_RATE_WINDOW_MS / 1000,
    });
    if (error) {
      if (error.code === "PGRST202") {
        console.warn(
          "[error-log-rate-limit] error_log_client_rate_limit_allow RPC not deployed; allowing write until migration is applied",
        );
        return true;
      }
      console.error("[error-log-rate-limit] rate limit check failed", error.message);
      return false;
    }
    return data === true;
  } catch (rateLimitError) {
    console.error("[error-log-rate-limit] unexpected rate limit failure", rateLimitError);
    return false;
  }
}
