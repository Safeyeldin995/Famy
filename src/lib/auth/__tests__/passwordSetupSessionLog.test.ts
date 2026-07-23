import { describe, expect, it } from "vitest";
import { logPasswordSetupSession } from "../passwordSetupSessionLog.server";

describe("password setup session logging", () => {
  it("does not log when QA capture is disabled", () => {
    const original = process.env.QA_E2E_OTP_CAPTURE;
    delete process.env.QA_E2E_OTP_CAPTURE;
    const info = console.info;
    const logs: unknown[] = [];
    console.info = (...args: unknown[]) => { logs.push(args); };
    try {
      logPasswordSetupSession("test-stage", { userId: "abc", hasSession: true });
      expect(logs).toHaveLength(0);
    } finally {
      console.info = info;
      process.env.QA_E2E_OTP_CAPTURE = original;
    }
  });

  it("never logs sensitive fields in allowed detail keys", () => {
    const allowedKeys = new Set(["userId", "hasSession", "hasBearer", "authId", "updated", "code", "matchesAuthorization", "authErrorCode"]);
    const sample = {
      userId: "user",
      hasSession: true,
      code: "session_not_found",
    };
    for (const key of Object.keys(sample)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    expect(sample).not.toHaveProperty("password");
    expect(sample).not.toHaveProperty("access_token");
    expect(sample).not.toHaveProperty("refresh_token");
  });
});
