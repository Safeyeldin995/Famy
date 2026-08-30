import { describe, expect, it } from "vitest";
import {
  buildErrorLogInsert,
  normalizeErrorLogLabel,
  normalizeErrorLogRoute,
  redactSensitiveText,
  sanitizeErrorMessage,
} from "@/lib/error-logging";

describe("error logging sanitization", () => {
  it("redacts jwt-like secrets from error messages", () => {
    const message = sanitizeErrorMessage(
      new Error("Auth failed eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def while loading /admin"),
    );
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("eyJ");
  });

  it("redacts emails, phone numbers, and UUIDs from error messages", () => {
    const message = sanitizeErrorMessage(
      new Error(
        "Failed for user@example.com on +201012345678 booking 550e8400-e29b-41d4-a716-446655440000",
      ),
    );
    expect(message).not.toContain("user@example.com");
    expect(message).not.toContain("+201012345678");
    expect(message).not.toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(message.match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("redacts PII from route and label normalization", () => {
    const route = normalizeErrorLogRoute(
      "/booking/550e8400-e29b-41d4-a716-446655440000/customer@example.com",
    );
    const label = normalizeErrorLogLabel("provider +201098765432 qa_monitoring_boundary_test");
    expect(route).toContain("[redacted]");
    expect(route).not.toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(label).toContain("[redacted]");
    expect(label).not.toContain("+201098765432");
  });

  it("truncates long messages to a safe maximum", () => {
    const message = sanitizeErrorMessage(new Error("x".repeat(700)));
    expect(message.length).toBeLessThanOrEqual(500);
    expect(message.endsWith("...")).toBe(true);
  });

  it("builds insert payloads with normalized route and label", () => {
    const payload = buildErrorLogInsert(new Error("qa_monitoring_boundary_test"), {
      source: "client",
      contextRoute: `/${"a".repeat(250)}`,
      contextLabel: `label-${"b".repeat(200)}`,
    });
    expect(payload.messageSafe).toBe("qa_monitoring_boundary_test");
    expect(payload.contextRoute?.length).toBe(200);
    expect(payload.contextLabel?.length).toBe(120);
  });

  it("returns null for blank route/label normalization", () => {
    expect(normalizeErrorLogRoute("   ")).toBeNull();
    expect(normalizeErrorLogLabel(undefined)).toBeNull();
  });

  it("redacts sensitive text without collapsing whitespace-only input", () => {
    expect(redactSensitiveText("contact user@example.com")).toBe("contact [redacted]");
  });
});
