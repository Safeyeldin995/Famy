import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import {
  configureQaEnvFilePathForTests,
  loadQaEnv,
  resetQaEnvFilePathForTests,
} from "../load-qa-env.mjs";
import {
  KNOWN_PRODUCTION_PROJECT_REF,
  KNOWN_QA_PROJECT_REF,
} from "../qa-identity.mjs";

const QA_ENV_KEYS = [
  "FAMY_ENV",
  "FAMY_QA_SUPABASE_PROJECT_REF",
  "FAMY_PRODUCTION_SUPABASE_PROJECT_REF",
  "QA_SUPABASE_URL",
  "QA_SUPABASE_PUBLISHABLE_KEY",
  "QA_SUPABASE_SECRET_KEY",
  "FAMY_QA_APP_ORIGIN",
  "FAMY_PRODUCTION_APP_ORIGIN",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
];

export function buildFakeQaEnvFileContent() {
  return [
    "FAMY_ENV=qa",
    `FAMY_QA_SUPABASE_PROJECT_REF=${KNOWN_QA_PROJECT_REF}`,
    `FAMY_PRODUCTION_SUPABASE_PROJECT_REF=${KNOWN_PRODUCTION_PROJECT_REF}`,
    `QA_SUPABASE_URL=https://${KNOWN_QA_PROJECT_REF}.supabase.co`,
    "QA_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test_placeholder",
    "QA_SUPABASE_SECRET_KEY=sb_secret_test_placeholder",
    "FAMY_QA_APP_ORIGIN=http://localhost:8099",
    "FAMY_PRODUCTION_APP_ORIGIN=https://famy-chi.vercel.app",
  ].join("\n");
}

/**
 * Isolated fake QA env file per test — never reads the repository .env.qa.local.
 */
export function useIsolatedQaEnv() {
  /** @type {string} */
  let tmpDir = "";
  /** @type {Record<string, string | undefined>} */
  let savedEnv = {};

  beforeEach(() => {
    savedEnv = {};
    for (const key of QA_ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-env-test-"));
    const envFile = path.join(tmpDir, ".env.qa.local");
    fs.writeFileSync(envFile, buildFakeQaEnvFileContent(), "utf8");
    configureQaEnvFilePathForTests(envFile);
    loadQaEnv({ required: true });
  });

  afterEach(() => {
    resetQaEnvFilePathForTests();
    for (const key of QA_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }

    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors in tests
      }
    }
  });
}
