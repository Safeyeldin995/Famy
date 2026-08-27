import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_ERROR_LOG_RATE_LIMIT,
  checkClientErrorLogRateLimit,
  resetClientErrorLogRateLimitForTests,
} from "@/lib/error-log-rate-limit.server";

describe("client error log rate limiting", () => {
  afterEach(() => {
    resetClientErrorLogRateLimitForTests();
  });

  it("allows requests up to the configured limit per key", () => {
    const key = "203.0.113.10";
    for (let i = 0; i < CLIENT_ERROR_LOG_RATE_LIMIT; i += 1) {
      expect(checkClientErrorLogRateLimit(key, 1_000)).toBe(true);
    }
    expect(checkClientErrorLogRateLimit(key, 1_000)).toBe(false);
  });

  it("resets the bucket after the window expires", () => {
    const key = "203.0.113.11";
    for (let i = 0; i < CLIENT_ERROR_LOG_RATE_LIMIT; i += 1) {
      expect(checkClientErrorLogRateLimit(key, 1_000)).toBe(true);
    }
    expect(checkClientErrorLogRateLimit(key, 1_000)).toBe(false);
    expect(checkClientErrorLogRateLimit(key, 62_000)).toBe(true);
  });
});
