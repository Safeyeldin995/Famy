import { describe, expect, it } from "vitest";
import {
  assertPlaywrightWebServerConfigEnvSecretFree,
  buildPlaywrightWebServerConfigEnv,
  buildPlaywrightWebServerEnv,
  getEffectiveNormalizedChildEnv,
} from "../playwright-webserver-env.mjs";
import {
  assertQaReportDirectorySecretFree,
  findSecretPatternsInText,
} from "../report-secret-guard.mjs";

const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxLCJleHAiOjk5fQ.fake-signature-part";
const FAKE_ANON_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoiYW5vbiIsImlhdCI6MSwiZXhwIjo5OX0.fake-signature-part";
const FAKE_SB_SECRET = "sb_secret_test_placeholder_value";

function fakeParentEnv() {
  return {
    QA_SUPABASE_URL: "https://bfwveoqbyqlhixjvdzha.supabase.co",
    QA_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake",
    QA_SUPABASE_SECRET_KEY: FAKE_JWT,
    AUTH_INTENT_SECRET: "test-auth-intent-secret",
    OTP_PROVIDER: "mock",
  };
}

describe("Playwright config env is secret-free by construction", () => {
  it("buildPlaywrightWebServerConfigEnv omits service-role and auth-intent secrets", () => {
    const configEnv = buildPlaywrightWebServerConfigEnv(fakeParentEnv());
    expect(configEnv.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(configEnv.AUTH_INTENT_SECRET).toBeUndefined();
    expect(configEnv.FAMY_QA_DEV_SERVER_WRAPPER).toBe("1");
    expect(configEnv.VITE_SUPABASE_URL).toBe("https://bfwveoqbyqlhixjvdzha.supabase.co");
  });

  it("serialized Playwright webServer config contains no service-role secrets", () => {
    const configEnv = buildPlaywrightWebServerConfigEnv(fakeParentEnv());
    const serialized = JSON.stringify({
      webServer: { env: configEnv, command: "node qa/playwright-dev-server.mjs" },
    });
    expect(findSecretPatternsInText(serialized)).toEqual([]);
    expect(() => assertPlaywrightWebServerConfigEnvSecretFree(configEnv)).not.toThrow();
  });

  it("dev-server wrapper still receives secrets via effective child env", () => {
    const parent = fakeParentEnv();
    const normalized = getEffectiveNormalizedChildEnv(parent, buildPlaywrightWebServerEnv(parent));
    expect(normalized.SUPABASE_SERVICE_ROLE_KEY).toBe(FAKE_JWT);
    expect(normalized.AUTH_INTENT_SECRET).toBe("test-auth-intent-secret");
  });
});

describe("QA report secret sentinel", () => {
  it("detects service-role JWT and sb_secret patterns but not anon publishable JWTs", () => {
    expect(findSecretPatternsInText(`{"key":"${FAKE_JWT}"}`).length).toBeGreaterThan(0);
    expect(findSecretPatternsInText(`{"key":"${FAKE_ANON_JWT}"}`)).toEqual([]);
    expect(findSecretPatternsInText(`{"key":"${FAKE_SB_SECRET}"}`).length).toBeGreaterThan(0);
    expect(findSecretPatternsInText('{"SUPABASE_SERVICE_ROLE_KEY":"not-empty"}').length).toBeGreaterThan(
      0,
    );
  });

  it("passes on secret-free report content", () => {
    expect(
      findSecretPatternsInText(
        JSON.stringify({ webServer: { env: { FAMY_ENV: "qa", VITE_SUPABASE_URL: "https://x.supabase.co" } } }),
      ),
    ).toEqual([]);
  });

  it("assertQaReportDirectorySecretFree passes when qa/report is absent", () => {
    expect(assertQaReportDirectorySecretFree("qa/report/does-not-exist-for-test")).toEqual({ ok: true });
  });
});
