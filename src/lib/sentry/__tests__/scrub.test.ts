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

  it("redacts structured secret keys in breadcrumbs and contexts before recursing", () => {
    const event = scrubSentryEvent({
      breadcrumbs: [
        {
          message: "[MockOTPProvider]",
          data: {
            phone: "+201012345678",
            otp: "654321",
            purpose: "login",
            timestamp: "2026-01-01T00:00:00.000Z",
          },
        },
      ],
      contexts: {
        auth: {
          password: "example-password",
          token: "opaque-token",
          otp: "654321",
          secret: "shh",
          authorization: "Bearer xyz",
          apiKey: "key-123",
          nested: { email: "leak@example.com", ok: "visible" },
        },
      },
      extra: { phoneNumber: "01099998888" },
    });
    const data = event.breadcrumbs?.[0]?.data as Record<string, unknown>;
    expect(data.phone).toBe("[redacted]");
    expect(data.otp).toBe("[redacted]");
    expect(data.purpose).toBe("login");
    expect(data.timestamp).toBe("2026-01-01T00:00:00.000Z");
    const auth = event.contexts?.auth as Record<string, unknown>;
    expect(auth.password).toBe("[redacted]");
    expect(auth.token).toBe("[redacted]");
    expect(auth.otp).toBe("[redacted]");
    expect(auth.secret).toBe("[redacted]");
    expect(auth.authorization).toBe("[redacted]");
    expect(auth.apiKey).toBe("[redacted]");
    const nested = auth.nested as Record<string, unknown>;
    expect(nested.email).toBe("[redacted]");
    expect(nested.ok).toBe("visible");
    expect(event.extra?.phoneNumber).toBe("[redacted]");
  });

  it("scrubs request url, query_string, headers, and data", () => {
    const event = scrubSentryEvent({
      message: "route error",
      request: {
        url: "/login?phone=01012345678&next=%2Fhome",
        query_string: "phone=01012345678&email=test@example.com",
        headers: {
          Cookie: "sb=eyJhbGciOiJIUzI1NiJ9.x",
          Authorization: "Bearer super-secret",
          "X-Custom": "ok",
        },
        data: { password: "pw", note: "user 01099998888" },
        cookies: { session: "secret-cookie" },
      },
    });
    expect(event.request?.url).not.toContain("01012345678");
    expect(event.request?.url).toMatch(/phone=(%5Bredacted%5D|\[redacted\])/);
    expect(event.request?.query_string).not.toContain("01012345678");
    expect(event.request?.query_string).toMatch(/phone=(%5Bredacted%5D|\[redacted\])/);
    expect(event.request?.headers?.Cookie).toBe("[redacted]");
    expect(event.request?.headers?.Authorization).toBe("[redacted]");
    expect(event.request?.headers?.["X-Custom"]).toBe("ok");
    const data = event.request?.data as Record<string, unknown>;
    expect(data.password).toBe("[redacted]");
    expect(String(data.note)).toContain("[redacted]");
    expect(event.request?.cookies).toEqual({ session: "[redacted]" });
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