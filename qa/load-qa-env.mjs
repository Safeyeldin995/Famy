// Explicit QA environment loader — reads .env.qa.local only.
// Never loads .env or .env.local. Never logs credential values.
import fs from "fs";
import path from "path";

const QA_ENV_FILE = path.resolve(process.cwd(), ".env.qa.local");

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

/**
 * @param {{ required?: boolean, inject?: Record<string, string> }} [options]
 */
export function loadQaEnv(options = {}) {
  const { required = true, inject } = options;

  if (inject) {
    applyEntries(inject, { override: true });
  }

  if (!inject && !fs.existsSync(QA_ENV_FILE)) {
    if (required) {
      throw new Error(
        "[qa-env] Missing .env.qa.local. Copy .env.qa.example to .env.qa.local and configure the Famy QA project.",
      );
    }
    return { loaded: false, path: QA_ENV_FILE };
  }

  if (!inject) {
    const raw = fs.readFileSync(QA_ENV_FILE, "utf8");
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

  return { loaded: true, path: QA_ENV_FILE };
}

export function qaEnvFilePath() {
  return QA_ENV_FILE;
}
