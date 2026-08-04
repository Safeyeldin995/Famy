import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  configureRegistryRootForTests,
  enableGuardedIntegrationRegistryMode,
  isIntegrationRegistryModeEnabled,
  registerUserEntry,
  registryPathsForTests,
  resetIntegrationRegistryModeForTests,
  resetRegistryRootForTests,
} from "../registry.mjs";
import {
  assertIntegrationRegistryPreconditions,
  canonicalQaRegistryDir,
  hasIntegrationSuiteMarker,
  OTP_INTEGRATION_MARKER,
  QA_INTEGRATION_REGISTRY_MARKER,
} from "../registry-integration-mode.mjs";
import { assertRegistryIntegrationGuardIntegrity } from "../registry-integration-guard-audit.mjs";
import {
  KNOWN_PRODUCTION_PROJECT_REF,
  KNOWN_QA_PROJECT_REF,
} from "../qa-identity.mjs";
import { useIsolatedRegistry } from "./registry-test-harness.ts";

const QA_URL = `https://${KNOWN_QA_PROJECT_REF}.supabase.co`;
const PROD_URL = `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`;

function validIntegrationEnv(overrides = {}) {
  return {
    FAMY_ENV: "qa",
    FAMY_QA_SUPABASE_PROJECT_REF: KNOWN_QA_PROJECT_REF,
    FAMY_PRODUCTION_SUPABASE_PROJECT_REF: KNOWN_PRODUCTION_PROJECT_REF,
    QA_SUPABASE_URL: QA_URL,
    QA_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    QA_SUPABASE_SECRET_KEY: "sb_secret_test",
    FAMY_QA_APP_ORIGIN: "http://localhost:8099",
    FAMY_PRODUCTION_APP_ORIGIN: "https://famy-chi.vercel.app",
    [QA_INTEGRATION_REGISTRY_MARKER]: "1",
    ...overrides,
  };
}

describe("guarded integration registry mode", () => {
  beforeEach(() => {
    resetRegistryRootForTests();
    resetIntegrationRegistryModeForTests();
  });

  afterEach(() => {
    resetRegistryRootForTests();
    resetIntegrationRegistryModeForTests();
  });

  it("rejects ordinary Vitest writes with default registry root", () => {
    expect(() => registerUserEntry({ userId: "blocked-user", email: "qa@famio.local" }))
      .toThrow(/configureRegistryRootForTests|enableGuardedIntegrationRegistryMode/);
  });

  it("allows ordinary Vitest writes with isolated temp root", () => {
    const tmpDir = fs.mkdtempSync(path.join(process.cwd(), "qa-registry-mode-test-"));
    try {
      configureRegistryRootForTests(tmpDir);
      expect(() => registerUserEntry({ userId: "isolated-user", email: "qa@famio.local" })).not.toThrow();
      expect(isIntegrationRegistryModeEnabled()).toBe(false);
    } finally {
      resetRegistryRootForTests();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects integration marker without QA guard", () => {
    expect(() => assertIntegrationRegistryPreconditions({
      FAMY_ENV: "qa",
      [QA_INTEGRATION_REGISTRY_MARKER]: "1",
    })).toThrow();
  });

  it("rejects FAMY_ENV=qa without explicit integration marker", () => {
    const env = validIntegrationEnv({
      [QA_INTEGRATION_REGISTRY_MARKER]: undefined,
      [OTP_INTEGRATION_MARKER]: undefined,
    });
    expect(hasIntegrationSuiteMarker(env)).toBe(false);
    expect(() => assertIntegrationRegistryPreconditions(env)).toThrow(/explicit integration-suite marker/);
  });

  it("rejects Production ref with integration marker", () => {
    expect(() => assertIntegrationRegistryPreconditions(validIntegrationEnv({
      QA_SUPABASE_URL: PROD_URL,
    }))).toThrow(/known QA project ref|Refusing known Production/);
  });

  it("rejects wrong QA ref with integration marker", () => {
    expect(() => assertIntegrationRegistryPreconditions(validIntegrationEnv({
      FAMY_QA_SUPABASE_PROJECT_REF: "wrongqaref1234567890123456789012",
      QA_SUPABASE_URL: QA_URL,
    }))).toThrow(/known QA project ref/);
  });

  it("allows correct known QA env plus marker in Vitest worker", () => {
    const env = validIntegrationEnv();
    expect(() => enableGuardedIntegrationRegistryMode(env)).not.toThrow();
    expect(isIntegrationRegistryModeEnabled()).toBe(true);
  });

  it("writes to canonical QA registry path when integration mode is enabled", () => {
    enableGuardedIntegrationRegistryMode(validIntegrationEnv());
    expect(registryPathsForTests()).toBe(canonicalQaRegistryDir());
    expect(registryPathsForTests()).toContain(`${path.sep}qa${path.sep}.auth`);
  });
});

describe("vitest config wiring", () => {
  it("does not load integration registry setup in unit config", () => {
    const source = fs.readFileSync(new URL("../../vitest.config.ts", import.meta.url), "utf8");
    expect(source.includes("vitest-integration-registry-setup.mjs")).toBe(false);
  });

  it("loads integration registry setup via setupFiles in integration config", () => {
    const source = fs.readFileSync(new URL("../../vitest.otp-integration.config.ts", import.meta.url), "utf8");
    expect(source.includes("vitest-integration-registry-setup.mjs")).toBe(true);
    expect(source.includes("setupFiles")).toBe(true);
    expect(source.includes("globalSetup")).toBe(true);
  });

  it("uses worker-local setupFiles rather than globalSetup alone", () => {
    const source = fs.readFileSync(new URL("../../vitest.otp-integration.config.ts", import.meta.url), "utf8");
    expect(source).toMatch(/setupFiles:\s*\[[^\]]*vitest-integration-registry-setup\.mjs/);
    expect(source).toMatch(/globalSetup:\s*\[[^\]]*vitest-otp-global-setup\.mjs/);
  });
});

describe("static integration registry guard audit", () => {
  it("passes regression guard for config and registry source", () => {
    expect(() => assertRegistryIntegrationGuardIntegrity()).not.toThrow();
  });
});

describe("existing registry tests remain isolated", () => {
  useIsolatedRegistry();

  it("still uses isolated temp registry roots in unit tests", () => {
    expect(() => registerUserEntry({ userId: "still-isolated", email: "qa@famio.local" })).not.toThrow();
    expect(isIntegrationRegistryModeEnabled()).toBe(false);
  });
});
