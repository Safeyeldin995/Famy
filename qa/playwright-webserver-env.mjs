/**
 * Deny-by-default Playwright webServer child environment.
 *
 * Playwright 1.61.1 merges:
 *   { ...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env, ...webServer.env }
 * Every non-approved parent/default key must be explicitly overridden with
 * undefined so Node child_process.spawn omits it from the child environment.
 */

/** Application variables required by the local Famy dev server during QA E2E. */
export const WEBSERVER_APPLICATION_ALLOWLIST = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "FAMY_ENV",
  "QA_E2E_OTP_CAPTURE",
  "AUTH_INTENT_SECRET",
  "OTP_PROVIDER",
  "VITE_OTP_PROVIDER",
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "NODE_ENV",
];

/**
 * Minimum OS/runtime variables validated for npm/Node startup on Windows/POSIX.
 * Validated locally on Windows without NODE, NODE_OPTIONS, NODE_PATH, or NPM_CONFIG_*:
 *   node --version && cmd /c npm --version both exit 0.
 */
export const WEBSERVER_RUNTIME_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "COMSPEC",
  "WINDIR",
  "USERPROFILE",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "HOMEDRIVE",
  "HOMEPATH",
  "PROGRAMFILES",
  "ProgramFiles(x86)",
  "CommonProgramFiles",
];

/**
 * Playwright 1.61.1 webServer DEFAULT_ENVIRONMENT_VARIABLES
 * (packages/playwright/src/plugins/webServerPlugin.ts).
 */
export const PLAYWRIGHT_DEFAULT_ENVIRONMENT_VARIABLES = {
  BROWSER: "none",
  FORCE_COLOR: "1",
  DEBUG_COLORS: "1",
};

/** Playwright defaults suppressed from the webServer child (not approved). */
export const PLAYWRIGHT_DEFAULT_SUPPRESSED_KEYS = ["BROWSER", "FORCE_COLOR", "DEBUG_COLORS"];

/** Exact runtime keys blocked from inheritance (code injection / redirection). */
export const RUNTIME_BLOCKED_EXACT_KEYS = ["NODE_OPTIONS", "NODE_PATH", "NODE"];

/** Known Admin/service-role aliases — always blocked even when absent from parent. */
export const FORBIDDEN_WEBSERVER_ENV_KEYS = [
  "QA_SUPABASE_SECRET_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE",
  "VITE_QA_SUPABASE_SECRET_KEY",
  "VITE_SUPABASE_SECRET_KEY",
  "VITE_SUPABASE_SERVICE_ROLE_KEY",
];

/**
 * Keys that must never appear in Playwright's serialized config (e.g. JSON reporter
 * output). The dev-server wrapper loads these directly from QA env at spawn time.
 */
export const WEBSERVER_CONFIG_SECRET_KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "AUTH_INTENT_SECRET"];

/** Playwright controller-only variables that must never reach the webServer child. */
export const PLAYWRIGHT_CONTROLLER_ONLY_KEYS = ["VERCEL_AUTOMATION_BYPASS_SECRET"];

/** @typedef {Record<string, string | undefined>} EnvRecord */

const APPROVED_APPLICATION = new Set(
  WEBSERVER_APPLICATION_ALLOWLIST.map((key) => key.toUpperCase()),
);
const APPROVED_RUNTIME = new Set(WEBSERVER_RUNTIME_ALLOWLIST.map((key) => key.toUpperCase()));
const FORBIDDEN = new Set(
  [...FORBIDDEN_WEBSERVER_ENV_KEYS, ...PLAYWRIGHT_CONTROLLER_ONLY_KEYS].map((key) =>
    key.toUpperCase(),
  ),
);
const RUNTIME_BLOCKED_EXACT = new Set(RUNTIME_BLOCKED_EXACT_KEYS.map((key) => key.toUpperCase()));
const PLAYWRIGHT_DEFAULT_SUPPRESSED = new Set(
  PLAYWRIGHT_DEFAULT_SUPPRESSED_KEYS.map((key) => key.toUpperCase()),
);

const CANONICAL_BY_UPPER = new Map();
for (const key of [...WEBSERVER_APPLICATION_ALLOWLIST, ...WEBSERVER_RUNTIME_ALLOWLIST]) {
  CANONICAL_BY_UPPER.set(key.toUpperCase(), key);
}

/**
 * @param {string} key
 */
export function normalizeEnvKey(key) {
  return key.toUpperCase();
}

/**
 * @param {string} key
 */
export function getCanonicalAllowlistKey(key) {
  return CANONICAL_BY_UPPER.get(normalizeEnvKey(key));
}

/**
 * @param {string} key
 */
export function isApprovedApplicationKey(key) {
  return APPROVED_APPLICATION.has(normalizeEnvKey(key));
}

/**
 * @param {string} key
 */
export function isApprovedRuntimeKey(key) {
  return APPROVED_RUNTIME.has(normalizeEnvKey(key));
}

/**
 * @param {string} key
 */
export function isApprovedChildKey(key) {
  return isApprovedApplicationKey(key) || isApprovedRuntimeKey(key);
}

/**
 * @param {string} key
 */
export function isForbiddenWebServerKey(key) {
  return FORBIDDEN.has(normalizeEnvKey(key));
}

/**
 * @param {string} key
 */
export function isRuntimeBlockedParentKey(key) {
  const upper = normalizeEnvKey(key);
  if (RUNTIME_BLOCKED_EXACT.has(upper)) return true;
  return upper.startsWith("NPM_CONFIG_");
}

/**
 * @param {EnvRecord} source
 * @param {string} targetKey
 */
function getSourceValueCaseInsensitive(source, targetKey) {
  const targetUpper = normalizeEnvKey(targetKey);
  for (const key of Object.keys(source)) {
    if (normalizeEnvKey(key) === targetUpper) {
      return source[key];
    }
  }
  return undefined;
}

/**
 * @param {EnvRecord} source
 */
function buildApprovedApplicationValues(source) {
  return {
    SUPABASE_URL: source.QA_SUPABASE_URL ?? "",
    SUPABASE_PUBLISHABLE_KEY: source.QA_SUPABASE_PUBLISHABLE_KEY ?? "",
    SUPABASE_SERVICE_ROLE_KEY: source.QA_SUPABASE_SECRET_KEY ?? "",
    VITE_SUPABASE_URL: source.QA_SUPABASE_URL ?? "",
    VITE_SUPABASE_PUBLISHABLE_KEY: source.QA_SUPABASE_PUBLISHABLE_KEY ?? "",
    FAMY_ENV: "qa",
    QA_E2E_OTP_CAPTURE: "1",
    AUTH_INTENT_SECRET: source.AUTH_INTENT_SECRET ?? "qa-local-auth-intent-secret",
    OTP_PROVIDER: source.OTP_PROVIDER ?? "mock",
    VITE_OTP_PROVIDER: source.VITE_OTP_PROVIDER ?? source.OTP_PROVIDER ?? "mock",
    VITE_FIREBASE_API_KEY: source.VITE_FIREBASE_API_KEY ?? "",
    VITE_FIREBASE_AUTH_DOMAIN: source.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    VITE_FIREBASE_PROJECT_ID: source.VITE_FIREBASE_PROJECT_ID ?? "",
    VITE_FIREBASE_STORAGE_BUCKET: source.VITE_FIREBASE_STORAGE_BUCKET ?? "",
    VITE_FIREBASE_MESSAGING_SENDER_ID: source.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    VITE_FIREBASE_APP_ID: source.VITE_FIREBASE_APP_ID ?? "",
    NODE_ENV: source.NODE_ENV ?? "development",
  };
}

/**
 * Node child_process.spawn omits keys whose values are undefined.
 * @param {EnvRecord} env
 * @returns {Record<string, string>}
 */
export function normalizeChildProcessEnv(env) {
  /** @type {Record<string, string>} */
  const normalized = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  return normalized;
}

/**
 * Playwright 1.61.1 merges webServer env as:
 *   { ...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env, ...webServer.env }
 * @param {EnvRecord} parentEnv
 * @param {EnvRecord} webServerEnvOverride
 * @param {EnvRecord} [playwrightDefaults]
 * @returns {EnvRecord}
 */
export function mergePlaywrightChildEnv(
  parentEnv,
  webServerEnvOverride,
  playwrightDefaults = PLAYWRIGHT_DEFAULT_ENVIRONMENT_VARIABLES,
) {
  return {
    ...playwrightDefaults,
    ...parentEnv,
    ...webServerEnvOverride,
  };
}

/**
 * Build deny-by-default webServer.env overrides for Playwright.
 * Does not mutate the supplied source object or process.env.
 * @param {EnvRecord} source
 * @returns {EnvRecord}
 */
export function buildPlaywrightWebServerEnv(source) {
  /** @type {EnvRecord} */
  const env = {
    ...buildApprovedApplicationValues(source),
  };

  for (const runtimeKey of WEBSERVER_RUNTIME_ALLOWLIST) {
    const value = getSourceValueCaseInsensitive(source, runtimeKey);
    if (value !== undefined) {
      env[runtimeKey] = value;
    }
  }

  for (const key of PLAYWRIGHT_DEFAULT_SUPPRESSED_KEYS) {
    env[key] = undefined;
  }

  for (const key of RUNTIME_BLOCKED_EXACT_KEYS) {
    env[key] = undefined;
  }

  for (const key of Object.keys(source)) {
    if (isRuntimeBlockedParentKey(key)) {
      env[key] = undefined;
    }
  }

  for (const key of Object.keys(source)) {
    const canonical = getCanonicalAllowlistKey(key);
    if (!canonical) {
      env[key] = undefined;
      continue;
    }
    if (canonical !== key) {
      env[key] = undefined;
    }
  }

  for (const key of [...FORBIDDEN_WEBSERVER_ENV_KEYS, ...PLAYWRIGHT_CONTROLLER_ONLY_KEYS]) {
    env[key] = undefined;
    for (const parentKey of Object.keys(source)) {
      if (normalizeEnvKey(parentKey) === normalizeEnvKey(key)) {
        env[parentKey] = undefined;
      }
    }
  }

  return env;
}

/**
 * @param {EnvRecord} parentEnv
 * @param {EnvRecord} [webServerEnvOverride]
 * @returns {Record<string, string>}
 */
export function getEffectiveNormalizedChildEnv(parentEnv, webServerEnvOverride) {
  const override = webServerEnvOverride ?? buildPlaywrightWebServerEnv(parentEnv);
  return normalizeChildProcessEnv(mergePlaywrightChildEnv(parentEnv, override));
}

/**
 * Validate the effective Playwright child env after merge and normalization.
 * @param {EnvRecord} parentEnv
 * @param {EnvRecord} [webServerEnvOverride]
 */
export function assertWebServerEnvLeastPrivilege(parentEnv, webServerEnvOverride) {
  const normalized = getEffectiveNormalizedChildEnv(parentEnv, webServerEnvOverride);

  for (const key of Object.keys(normalized)) {
    if (isForbiddenWebServerKey(key)) {
      throw new Error(
        `[qa-playwright] Forbidden/controller-only key survived Playwright env merge: ${key}`,
      );
    }
    if (isRuntimeBlockedParentKey(key)) {
      throw new Error(`[qa-playwright] Blocked runtime key survived Playwright env merge: ${key}`);
    }
    if (PLAYWRIGHT_DEFAULT_SUPPRESSED.has(normalizeEnvKey(key))) {
      throw new Error(`[qa-playwright] Playwright default key survived suppression: ${key}`);
    }
    if (!isApprovedChildKey(key)) {
      throw new Error(`[qa-playwright] Unknown parent key survived deny-by-default filter: ${key}`);
    }
  }

  for (const key of FORBIDDEN_WEBSERVER_ENV_KEYS) {
    for (const presentKey of Object.keys(normalized)) {
      if (normalizeEnvKey(presentKey) === normalizeEnvKey(key)) {
        throw new Error(
          `[qa-playwright] Forbidden secret key present in normalized child env: ${presentKey}`,
        );
      }
    }
  }
}

export const WEBSERVER_APPROVED_CHILD_KEYS = [
  ...WEBSERVER_APPLICATION_ALLOWLIST,
  ...WEBSERVER_RUNTIME_ALLOWLIST,
];

const CONFIG_SECRET_KEYS = new Set(WEBSERVER_CONFIG_SECRET_KEYS.map((key) => normalizeEnvKey(key)));

/**
 * Build webServer.env for Playwright config serialization only — secret-free.
 * Actual child secrets are injected by qa/playwright-dev-server.mjs at spawn.
 * @param {EnvRecord} source
 * @returns {EnvRecord}
 */
export function buildPlaywrightWebServerConfigEnv(source) {
  const childEnv = buildPlaywrightWebServerEnv(source);
  /** @type {EnvRecord} */
  const configEnv = { FAMY_QA_DEV_SERVER_WRAPPER: "1" };
  for (const [key, value] of Object.entries(childEnv)) {
    if (CONFIG_SECRET_KEYS.has(normalizeEnvKey(key))) {
      configEnv[key] = undefined;
      continue;
    }
    configEnv[key] = value;
  }
  return configEnv;
}

/**
 * Assert Playwright config env contains no secret material (post-serialization guard).
 * @param {EnvRecord} configEnv
 */
export function assertPlaywrightWebServerConfigEnvSecretFree(configEnv) {
  for (const [key, value] of Object.entries(configEnv)) {
    if (value === undefined) continue;
    if (CONFIG_SECRET_KEYS.has(normalizeEnvKey(key))) {
      throw new Error(
        `[qa-playwright] Secret key must not appear in Playwright config env: ${key}`,
      );
    }
    if (isForbiddenWebServerKey(key)) {
      throw new Error(
        `[qa-playwright] Forbidden key must not appear in Playwright config env: ${key}`,
      );
    }
  }
}
