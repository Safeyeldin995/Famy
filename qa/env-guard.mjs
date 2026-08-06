// Fail-closed QA environment guard. Pure validation — no network, no credentials logged.

import {
  KNOWN_PRODUCTION_PROJECT_REF,
  KNOWN_QA_PROJECT_REF,
  parseSupabaseProjectRef,
} from "./qa-identity.mjs";

export { KNOWN_QA_PROJECT_REF, KNOWN_PRODUCTION_PROJECT_REF, parseSupabaseProjectRef };

/** @typedef {Record<string, string | undefined>} Env */

/**
 * @param {string | undefined} origin
 */
export function normalizeAppOrigin(origin) {
  if (!origin || typeof origin !== "string" || !origin.trim()) {
    throw new Error("[qa-guard] App origin is missing or blank.");
  }

  const raw = origin.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("[qa-guard] App origin is not a valid URL.");
  }

  if (url.username || url.password) {
    throw new Error("[qa-guard] App origin must not contain credentials.");
  }

  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("[qa-guard] App origin must not include a path, query, or fragment.");
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("[qa-guard] App origin must use http or https.");
  }

  let port = url.port;
  if ((protocol === "http:" && port === "80") || (protocol === "https:" && port === "443")) {
    port = "";
  }

  const host = url.hostname.toLowerCase();
  const portSuffix = port ? `:${port}` : "";
  return `${protocol}//${host}${portSuffix}`;
}

/**
 * @param {Env} env
 * @returns {string[]}
 */
export function collectQaGuardErrors(env) {
  const errors = [];

  if (env.FAMY_ENV !== "qa") {
    errors.push('FAMY_ENV must be exactly "qa" for QA commands.');
  }

  const qaRefEnv = env.FAMY_QA_SUPABASE_PROJECT_REF?.trim();
  const prodRefEnv = env.FAMY_PRODUCTION_SUPABASE_PROJECT_REF?.trim();
  if (!qaRefEnv) errors.push("FAMY_QA_SUPABASE_PROJECT_REF is required.");
  if (!prodRefEnv) errors.push("FAMY_PRODUCTION_SUPABASE_PROJECT_REF is required.");

  if (qaRefEnv && qaRefEnv !== KNOWN_QA_PROJECT_REF) {
    errors.push("FAMY_QA_SUPABASE_PROJECT_REF does not match the known QA project ref.");
  }
  if (prodRefEnv && prodRefEnv !== KNOWN_PRODUCTION_PROJECT_REF) {
    errors.push("FAMY_PRODUCTION_SUPABASE_PROJECT_REF does not match the known Production project ref.");
  }
  if (qaRefEnv && prodRefEnv && qaRefEnv === prodRefEnv) {
    errors.push("FAMY_QA_SUPABASE_PROJECT_REF must differ from FAMY_PRODUCTION_SUPABASE_PROJECT_REF.");
  }

  if (!env.QA_SUPABASE_URL?.trim()) {
    errors.push("QA_SUPABASE_URL is required (do not use generic SUPABASE_URL from .env).");
    if (env.SUPABASE_URL?.trim()) {
      errors.push("Generic SUPABASE_URL fallback is not allowed as a QA source.");
    }
  }

  if (!env.QA_SUPABASE_PUBLISHABLE_KEY?.trim()) {
    errors.push("QA_SUPABASE_PUBLISHABLE_KEY is required.");
  }

  if (!env.QA_SUPABASE_SECRET_KEY?.trim()) {
    errors.push("QA_SUPABASE_SECRET_KEY is required for Node/Admin QA operations.");
  }

  for (const key of Object.keys(env)) {
    if (/^VITE_.*(SECRET|SERVICE.?ROLE)/i.test(key)) {
      errors.push(`Browser-prefixed secret env var is forbidden: ${key}`);
    }
  }
  if (env.VITE_QA_SUPABASE_SECRET_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
    errors.push("QA secret key must not use a VITE_ prefix.");
  }

  let actualRef = "";
  try {
    actualRef = parseSupabaseProjectRef(env.QA_SUPABASE_URL);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (actualRef && actualRef !== KNOWN_QA_PROJECT_REF) {
    errors.push("QA_SUPABASE_URL must resolve to the known QA project ref.");
  }

  if (actualRef && actualRef === KNOWN_PRODUCTION_PROJECT_REF) {
    errors.push("Refusing known Production Supabase project ref for QA operations.");
  }

  let qaOrigin = "";
  let prodOrigin = "";
  try {
    qaOrigin = normalizeAppOrigin(env.FAMY_QA_APP_ORIGIN);
    prodOrigin = normalizeAppOrigin(env.FAMY_PRODUCTION_APP_ORIGIN);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (qaOrigin && prodOrigin && qaOrigin === prodOrigin) {
    errors.push("FAMY_QA_APP_ORIGIN must differ from FAMY_PRODUCTION_APP_ORIGIN.");
  }

  return errors;
}

/**
 * @param {Env} env
 */
export function validateQaEnvironment(env) {
  const errors = collectQaGuardErrors(env);
  if (errors.length) {
    throw new Error(`[qa-guard] ${errors.join(" ")}`);
  }
  return {
    qaProjectRef: KNOWN_QA_PROJECT_REF,
    productionProjectRef: KNOWN_PRODUCTION_PROJECT_REF,
    qaAppOrigin: normalizeAppOrigin(env.FAMY_QA_APP_ORIGIN),
    productionAppOrigin: normalizeAppOrigin(env.FAMY_PRODUCTION_APP_ORIGIN),
  };
}

/**
 * @param {{
 *   playwrightBaseUrl?: string;
 *   qaSupabaseUrl?: string;
 *   viteSupabaseUrl?: string;
 *   qaAppOrigin?: string;
 *   productionAppOrigin?: string;
 * }} input
 */
export function validateUiDatabaseAlignment(input) {
  const errors = [];
  const qaRef = parseSupabaseProjectRef(input.qaSupabaseUrl);
  const viteRef = parseSupabaseProjectRef(input.viteSupabaseUrl ?? input.qaSupabaseUrl);

  if (qaRef !== KNOWN_QA_PROJECT_REF) {
    errors.push("Node QA Supabase ref must equal the known QA project ref.");
  }
  if (viteRef !== KNOWN_QA_PROJECT_REF) {
    errors.push("Browser Supabase project ref must equal the known QA project ref.");
  }
  if (qaRef !== viteRef) {
    errors.push("Browser Supabase project ref must match QA_SUPABASE_URL.");
  }

  const base = input.playwrightBaseUrl ? normalizeAppOrigin(input.playwrightBaseUrl) : "";
  const qaOrigin = normalizeAppOrigin(input.qaAppOrigin);
  const prodOrigin = normalizeAppOrigin(input.productionAppOrigin);

  if (base && base === prodOrigin) {
    errors.push("Playwright UI origin cannot be the Production app origin.");
  }

  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base);
  if (base && !isLocal) {
    if (base !== qaOrigin) {
      errors.push("Playwright UI origin must match the allowlisted FAMY_QA_APP_ORIGIN for remote E2E.");
    }
  }

  if (errors.length) {
    throw new Error(`[qa-guard] UI/database mismatch: ${errors.join(" ")}`);
  }

  return { qaProjectRef: qaRef, playwrightBaseUrl: base || qaOrigin };
}

/**
 * @param {Env} [env]
 */
export function assertQaWriteGuard(env = process.env) {
  validateQaEnvironment(env);
}

/**
 * @param {Env} [env]
 */
export function runPreflightChecks(env = process.env) {
  return validateQaEnvironment(env);
}
