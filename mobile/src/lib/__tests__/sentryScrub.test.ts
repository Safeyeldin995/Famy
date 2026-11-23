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