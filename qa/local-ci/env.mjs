/**
 * Local CI environment: an ephemeral Supabase stack started by `supabase start`
 * inside the CI runner (or a developer's Docker), never a hosted project.
 *
 * This is a separate path from the hosted QA harness (qa/env-guard.mjs). That
 * guard only accepts the known QA project; this one only accepts loopback
 * hosts, so neither can be pointed at Production by changing one variable.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { KNOWN_PRODUCTION_PROJECT_REF, KNOWN_QA_PROJECT_REF } from "../qa-identity.mjs";

export const LOCAL_CI_ENV_FILE = ".env.local-ci";
export const LOCAL_CI_FAMY_ENV = "local-ci";
export const LOCAL_CI_APP_PORT = 8099;

const LOOPBACK_URL_RE = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/?$/;
const LOOPBACK_PG_RE = /^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d{2,5}\/[a-z_]+$/;

/** Keys that hold a URL the browser, server or seed will talk to. */
const URL_KEYS = ["LOCAL_SUPABASE_URL", "SUPABASE_URL", "VITE_SUPABASE_URL"];

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function collectLocalCiGuardErrors(env) {
  const errors = [];
  if (env.FAMY_ENV !== LOCAL_CI_FAMY_ENV) {
    errors.push(`FAMY_ENV must be "${LOCAL_CI_FAMY_ENV}".`);
  }
  for (const key of URL_KEYS) {
    const value = env[key];
    if (!value) {
      errors.push(`${key} is missing.`);
      continue;
    }
    if (!LOOPBACK_URL_RE.test(value.trim())) {
      errors.push(`${key} must be a loopback http URL (127.0.0.1 or localhost).`);
    }
  }
  if (env.LOCAL_DB_URL && !LOOPBACK_PG_RE.test(env.LOCAL_DB_URL.trim())) {
    errors.push("LOCAL_DB_URL must point at a loopback Postgres.");
  }
  for (const key of ["LOCAL_SUPABASE_PUBLISHABLE_KEY", "LOCAL_SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!env[key]) errors.push(`${key} is missing.`);
  }
  // Belt and braces: no value anywhere in the env may name a hosted project.
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    if (value.includes(KNOWN_PRODUCTION_PROJECT_REF) || value.includes(KNOWN_QA_PROJECT_REF)) {
      errors.push(`${key} names a hosted Famy Supabase project; local CI only runs on a local stack.`);
    }
    if (/^(SUPABASE_URL|VITE_SUPABASE_URL|LOCAL_SUPABASE_URL)$/.test(key) && /supabase\.(co|in)/i.test(value)) {
      errors.push(`${key} points at a hosted Supabase project.`);
    }
  }
  for (const key of Object.keys(env)) {
    if (/^VITE_.*(SECRET|SERVICE_ROLE)/i.test(key)) {
      errors.push(`${key} must not exist: VITE_* values are shipped to the browser.`);
    }
  }
  return errors;
}

/** @param {Record<string, string | undefined>} env */
export function assertLocalCiEnv(env) {
  const errors = collectLocalCiGuardErrors(env);
  if (errors.length) {
    throw new Error(`[local-ci] refusing to run:\n- ${errors.join("\n- ")}`);
  }
}

/** @param {string} raw */
function parseEnvText(raw) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[trimmed.slice(0, i).trim()] = value;
  }
  return out;
}

/** Reads `supabase status -o env` from the running local stack. */
export function readSupabaseStatus(cwd = process.cwd()) {
  const raw = execFileSync("supabase", ["status", "-o", "env"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const status = parseEnvText(raw);
  const apiUrl = status.API_URL;
  const publishable = status.PUBLISHABLE_KEY || status.ANON_KEY;
  const serviceRole = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (!apiUrl || !publishable || !serviceRole || !status.DB_URL) {
    throw new Error("[local-ci] `supabase status` did not report API_URL, keys and DB_URL. Is the stack running?");
  }
  return { apiUrl, publishable, serviceRole, dbUrl: status.DB_URL };
}

/** Builds the full local CI env from a running stack and validates it. */
export function buildLocalCiEnv(status) {
  const env = {
    FAMY_ENV: LOCAL_CI_FAMY_ENV,
    LOCAL_SUPABASE_URL: status.apiUrl,
    LOCAL_SUPABASE_PUBLISHABLE_KEY: status.publishable,
    LOCAL_SUPABASE_SERVICE_ROLE_KEY: status.serviceRole,
    LOCAL_DB_URL: status.dbUrl,
    SUPABASE_URL: status.apiUrl,
    SUPABASE_PUBLISHABLE_KEY: status.publishable,
    VITE_SUPABASE_URL: status.apiUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: status.publishable,
    OTP_PROVIDER: "mock",
    VITE_OTP_PROVIDER: "mock",
  };
  assertLocalCiEnv(env);
  return env;
}

/** Loads .env.local-ci into process.env (without overriding) and validates it. */
export function loadLocalCiEnv(cwd = process.cwd()) {
  const file = path.resolve(cwd, LOCAL_CI_ENV_FILE);
  if (!fs.existsSync(file)) {
    throw new Error(`[local-ci] ${LOCAL_CI_ENV_FILE} is missing. Run: node qa/local-ci/write-env.mjs`);
  }
  const values = parseEnvText(fs.readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (!(key in process.env)) process.env[key] = value;
  }
  assertLocalCiEnv(process.env);
  return values;
}

/** supabase-js browser storage key for a Supabase URL (mirrors supabase-js). */
export function supabaseAuthStorageKey(supabaseUrl) {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}
