import { describe, expect, it } from "vitest";
import { scrubMobileSentryEvent } from "../sentryScrub";

describe("scrubMobileSentryEvent", () => {
  it("redacts exception.values[].value", () => {
    const event = scrubMobileSentryEvent({
      exception: {
        values: [{ type: "Error", value: "auth failed for 01012345678 and user@test.com" }],
      },
    });
    expect(event.exception?.values?.[0]?.value).not.toContain("01012345678");
    expect(event.exception?.values?.[0]?.value).toContain("[redacted]");
  });

  it("redacts structured secret keys in breadcrumb data (same scrub-core as web)", () => {
    const event = scrubMobileSentryEvent({
      breadcrumbs: [
        {
          message: "otp send",
          data: {
            token: "mobile-token",
            otp: "123456",
            phone: "01012345678",
            meta: { api_key: "secret-key", channel: "sms" },
          },
        },
      ],
      contexts: {
        credentials: { password: "pw", authorization: "Bearer abc" },
      },
    });
    const data = event.breadcrumbs?.[0]?.data as Record<string, unknown>;
    expect(data.token).toBe("[redacted]");
    expect(data.otp).toBe("[redacted]");
    expect(data.phone).toBe("[redacted]");
    const meta = data.meta as Record<string, unknown>;
    expect(meta.api_key).toBe("[redacted]");
    expect(meta.channel).toBe("sms");
    const creds = event.contexts?.credentials as Record<string, unknown>;
    expect(creds.password).toBe("[redacted]");
    expect(creds.authorization).toBe("[redacted]");
  });

  it("scrubs breadcrumbs, extra, and contexts", () => {
    const event = scrubMobileSentryEvent({
      breadcrumbs: [{ message: "clicked 01099998888", data: { email: "a@b.com" } }],
      extra: { phone: "01012345678" },
      contexts: { session: { note: "call user@test.com" } },
    });
    expect(event.breadcrumbs?.[0]?.message).toContain("[redacted]");
    expect(event.breadcrumbs?.[0]?.data?.email).toBe("[redacted]");
    expect(event.extra?.phone).toBe("[redacted]");
    expect(String(event.contexts?.session?.note)).toContain("[redacted]");
    expect(String(event.contexts?.session?.note)).not.toContain("@");
  });
});