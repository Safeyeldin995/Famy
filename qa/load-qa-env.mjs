// Explicit QA environment loader — reads .env.qa.local only.
// Never loads .env or .env.local. Never logs credential values.
import fs from "fs";
import path from "path";

const QA_ENV_FILE = path.resolve(process.cwd(), ".env.qa.local");

/** @type {string | null} */
let testQaEnvFileOverride = null;

function assertVitestRuntime() {
  if (process.env.VITEST !== "true") {
    throw new Error("[qa-env] Test-only QA env override is available only under Vitest.");
  }
}

/**
 * @param {string} filePath
 */
export function configureQaEnvFilePathForTests(filePath) {
  assertVitestRuntime();
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("[qa-env] Test QA env file path must be a non-empty string.");
  }
  testQaEnvFileOverride = path.resolve(filePath);
}

export function resetQaEnvFilePathForTests() {
  assertVitestRuntime();
  testQaEnvFileOverride = null;
}

export function isVitestQaEnvOverrideActive() {
  return testQaEnvFileOverride !== null;
}

/**
 * @param {string} raw
 */
export function parseEnvFile(raw) {
  const entries = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function applyEntries(entries, { override = false } = {}) {
  for (const [key, value] of Object.entries(entries)) {
    if (override || !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function assertUnitTestUsesIsolatedQaEnv() {
  if (process.env.VITEST !== "true" || process.env.VITEST_QA_UNIT_GUARD !== "1") {
    return;
  }
  if (!testQaEnvFileOverride) {
    throw new Error(
      "[qa-env] Unit tests must call useIsolatedQaEnv() before guard-backed QA code. Refusing implicit .env.qa.local access.",
    );
  }
  const repoEnv = path.resolve(process.cwd(), ".env.qa.local");
  if (path.resolve(testQaEnvFileOverride) === repoEnv) {
    throw new Error(
      "[qa-env] Unit tests must not point the QA env override at the repository .env.qa.local.",
    );
  }
}

/**
 * @param {{ required?: boolean, inject?: Record<string, string> }} [options]
 */
export function loadQaEnv(options = {}) {
  const { required = true, inject } = options;

  if (required && !inject) {
    assertUnitTestUsesIsolatedQaEnv();
  }

  const envFile = qaEnvFilePath();

  if (inject) {
    applyEntries(inject, { override: true });
  }

  if (!inject && !fs.existsSync(envFile)) {
    if (required) {
      throw new Error(
        testQaEnvFileOverride
          ? `[qa-env] Missing isolated test QA env file at ${envFile}.`
          : "[qa-env] Missing .env.qa.local. Copy .env.qa.example to .env.qa.local and configure the Famy QA project.",
      );
    }
    return { loaded: false, path: envFile };
  }

  if (!inject) {
    const raw = fs.readFileSync(envFile, "utf8");
    applyEntries(parseEnvFile(raw), { override: true });
  }

  if (process.env.QA_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.QA_SUPABASE_URL;
  }
  if (process.env.QA_SUPABASE_PUBLISHABLE_KEY) {
    process.env.SUPABASE_PUBLISHABLE_KEY = process.env.QA_SUPABASE_PUBLISHABLE_KEY;
    process.env.VITE_SUPABASE_URL = process.env.QA_SUPABASE_URL;
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = process.env.QA_SUPABASE_PUBLISHABLE_KEY;
  }
  if (process.env.QA_SUPABASE_SECRET_KEY) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.QA_SUPABASE_SECRET_KEY;
  }

  return { loaded: true, path: envFile };
}

export function qaEnvFilePath() {
  return testQaEnvFileOverride ?? QA_ENV_FILE;
}
