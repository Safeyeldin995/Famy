import { getRequest } from "@tanstack/react-start/server";

/** Mirrors OTP public-endpoint throttling: bounded writes per client identity. */
export const CLIENT_ERROR_LOG_RATE_LIMIT = 20;
export const CLIENT_ERROR_LOG_RATE_WINDOW_MS = 60_000;

type RateBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateBucket>();

export function resolveClientErrorLogRateLimitKey(request: Request): string {
  const ipAddress =
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-vercel-forwarded-for")?.split(",").pop()?.trim() ??
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
    "unknown";
  return ipAddress || "unknown";
}

export function checkClientErrorLogRateLimit(
  key: string,
  now = Date.now(),
): boolean {
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + CLIENT_ERROR_LOG_RATE_WINDOW_MS });
    pruneExpiredBuckets(now);
    return true;
  }

  if (bucket.count >= CLIENT_ERROR_LOG_RATE_LIMIT) {
    return false;
  }

  bucket.count += 1;
  return true;
}

export function assertClientErrorLogRateLimit(): boolean {
  const request = getRequest();
  const key = resolveClientErrorLogRateLimitKey(request);
  return checkClientErrorLogRateLimit(key);
}

function pruneExpiredBuckets(now: number) {
  if (buckets.size <= 256) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export function resetClientErrorLogRateLimitForTests() {
  buckets.clear();
}
