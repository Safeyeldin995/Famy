import { describe, expect, it } from "vitest";
import { scrubSentryEvent } from "../scrub";

describe("scrubSentryEvent", () => {
  it("redacts phone numbers and emails in messages", () => {
    const event = scrubSentryEvent({
      message: "failed for user 01012345678 and test@example.com",
    });
    expect(event.message).not.toContain("01012345678");
    expect(event.message).not.toContain("test@example.com");
    expect(event.message).toContain("[redacted]");
  });

  it("redacts exception.values[].value", () => {
    const event = scrubSentryEvent({
      exception: {
        values: [{ type: "AuthError", value: "OTP failed for 01012345678 user@example.com" }],
      },
    });
    expect(event.exception?.values?.[0]?.value).not.toContain("01012345678");
    expect(event.exception?.values?.[0]?.value).toContain("[redacted]");
  });

  it("scrubs nested breadcrumb and context strings", () => {
    const event = scrubSentryEvent({
      breadcrumbs: [{ message: "nav", data: { route: "/user/01012345678" } }],
      extra: { detail: "token eyJhbGciOiJIUzI1NiJ9.x.y" },
    });
    expect(event.breadcrumbs?.[0]?.data?.route).toContain("[redacted]");
    expect(String(event.breadcrumbs?.[0]?.data?.route)).not.toContain("01012345678");
    expect(event.extra?.detail).toContain("[redacted]");
  });

  it("strips user PII fields", () => {
    const event = scrubSentryEvent({
      user: {
        id: "user-123",
        email: "test@example.com",
        username: "Ahmed",
        ip_address: "1.2.3.4",
      },
    });
    expect(event.user?.id).toBe("[redacted]");
    expect(event.user?.email).toBeUndefined();
    expect(event.user?.username).toBeUndefined();
    expect(event.user?.ip_address).toBeUndefined();
  });
});