import { describe, expect, it } from "vitest";
import {
  buildErrorLogInsert,
  normalizeErrorLogLabel,
  normalizeErrorLogRoute,
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
});
