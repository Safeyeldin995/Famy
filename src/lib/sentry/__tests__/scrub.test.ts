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