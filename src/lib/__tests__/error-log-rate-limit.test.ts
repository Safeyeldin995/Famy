import { describe, expect, it } from "vitest";
import { resolveClientErrorLogRateLimitKey } from "@/lib/error-log-rate-limit.server";

describe("client error log rate limit key resolution", () => {
  it("prefers x-real-ip and falls back to unknown", () => {
    const withRealIp = new Request("https://example.test/log", {
      headers: { "x-real-ip": "203.0.113.10" },
    });
    expect(resolveClientErrorLogRateLimitKey(withRealIp)).toBe("203.0.113.10");

    const withoutIp = new Request("https://example.test/log");
    expect(resolveClientErrorLogRateLimitKey(withoutIp)).toBe("unknown");
  });

  it("uses the right-most forwarded-for address when present", () => {
    const request = new Request("https://example.test/log", {
      headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.44" },
    });
    expect(resolveClientErrorLogRateLimitKey(request)).toBe("203.0.113.44");
  });
});
