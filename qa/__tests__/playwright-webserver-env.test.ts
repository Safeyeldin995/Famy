import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  assertWebServerEnvLeastPrivilege,
  buildPlaywrightWebServerEnv,
  FORBIDDEN_WEBSERVER_ENV_KEYS,
  getEffectiveNormalizedChildEnv,
  mergePlaywrightChildEnv,
  normalizeChildProcessEnv,
  normalizeEnvKey,
  PLAYWRIGHT_CONTROLLER_ONLY_KEYS,
  PLAYWRIGHT_DEFAULT_ENVIRONMENT_VARIABLES,
  PLAYWRIGHT_DEFAULT_SUPPRESSED_KEYS,
  RUNTIME_BLOCKED_EXACT_KEYS,
  WEBSERVER_APPLICATION_ALLOWLIST,
  WEBSERVER_APPROVED_CHILD_KEYS,
  WEBSERVER_RUNTIME_ALLOWLIST,
} from "../playwright-webserver-env.mjs";

const QA_URL = "https://bfwveoqbyqlhixjvdzha.supabase.co";
const FAKE_SECRET = "FAKE_SENTINEL_SECRET_DO_NOT_USE";

const UNKNOWN_SECRET_KEYS = [
  "AWS_SECRET_ACCESS_KEY",
  "GITHUB_TOKEN",
  "OPENAI_API_KEY",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "RANDOM_PRIVATE_THING",
];

const NPM_CONFIG_KEYS = [
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_PREFIX",
  "NPM_CONFIG_USERCONFIG",
  "NPM_CONFIG_GLOBALCONFIG",
  "npm_config_registry",
];

function pickRuntimeFromProcessEnv() {
  /** @type {Record<string, string>} */
  const runtime = {};
  for (const key of WEBSERVER_RUNTIME_ALLOWLIST) {
    for (const envKey of Object.keys(process.env)) {
      if (normalizeEnvKey(envKey) === normalizeEnvKey(key) && process.env[envKey] !== undefined) {
        runtime[envKey] = process.env[envKey];
      }
    }
  }
  return runtime;
}

function fakeParentEnv(extra: Record<string, string> = {}) {
  return Object.freeze({
    QA_SUPABASE_URL: QA_URL,
    QA_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake",
    QA_SUPABASE_SECRET_KEY: FAKE_SECRET,
    SUPABASE_SECRET_KEY: FAKE_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: FAKE_SECRET,
    SUPABASE_SERVICE_ROLE: FAKE_SECRET,
    VITE_QA_SUPABASE_SECRET_KEY: FAKE_SECRET,
    VITE_SUPABASE_SECRET_KEY: FAKE_SECRET,
    VITE_SUPABASE_SERVICE_ROLE_KEY: FAKE_SECRET,
    AWS_SECRET_ACCESS_KEY: FAKE_SECRET,
    GITHUB_TOKEN: FAKE_SECRET,
    OPENAI_API_KEY: FAKE_SECRET,
    VERCEL_AUTOMATION_BYPASS_SECRET: FAKE_SECRET,
    RANDOM_PRIVATE_THING: FAKE_SECRET,
    aws_secret_access_key: FAKE_SECRET,
    github_token: FAKE_SECRET,
    vercel_automation_bypass_secret: FAKE_SECRET,
    NODE_OPTIONS: "--require=evil",
    NODE_PATH: "C:\\evil\\node_modules",
    NODE: "C:\\evil\\node.exe",
    NPM_CONFIG_CACHE: "C:\\evil\\npm-cache",
    NPM_CONFIG_PREFIX: "C:\\evil\\npm-prefix",
    NPM_CONFIG_USERCONFIG: "C:\\evil\\.npmrc",
    NPM_CONFIG_GLOBALCONFIG: "C:\\evil\\global.npmrc",
    npm_config_registry: "https://evil.example/",
    UNRELATED_PARENT_VAR: "parent-runtime-value",
    AUTH_INTENT_SECRET: "parent-auth-intent",
    OTP_PROVIDER: "mock",
    NODE_ENV: "test",
    ...pickRuntimeFromProcessEnv(),
    ...extra,
  });
}

function expectKeyAbsent(normalized: Record<string, string | undefined>, key: string) {
  for (const presentKey of Object.keys(normalized)) {
    expect(normalizeEnvKey(presentKey)).not.toBe(normalizeEnvKey(key));
  }
}

describe("playwright webServer deny-by-default env", () => {
  it("does not mutate the supplied source object", () => {
    const parent = fakeParentEnv();
    const snapshot = { ...parent };
    buildPlaywrightWebServerEnv(parent);
    expect({ ...parent }).toEqual(snapshot);
  });

  it("models Playwright exact merge order with DEFAULT_ENVIRONMENT_VARIABLES", () => {
    const parent = fakeParentEnv();
    const override = buildPlaywrightWebServerEnv(parent);
    const effective = mergePlaywrightChildEnv(parent, override);
    expect(effective.BROWSER).toBeUndefined();
    expect(effective.FORCE_COLOR).toBeUndefined();
    expect(effective.DEBUG_COLORS).toBeUndefined();
    expect(normalizeChildProcessEnv(effective).BROWSER).toBeUndefined();
  });

  it("suppresses Playwright defaults even when only defaults would apply", () => {
    const parent = { QA_SUPABASE_URL: QA_URL, QA_SUPABASE_PUBLISHABLE_KEY: "pub", ...pickRuntimeFromProcessEnv() };
    const normalized = getEffectiveNormalizedChildEnv(parent);
    for (const key of PLAYWRIGHT_DEFAULT_SUPPRESSED_KEYS) {
      expectKeyAbsent(normalized, key);
    }
  });

  it("blocks NODE_OPTIONS, NODE_PATH, NODE, and every NPM_CONFIG_* parent variable", () => {
    const normalized = getEffectiveNormalizedChildEnv(fakeParentEnv());
    for (const key of [...RUNTIME_BLOCKED_EXACT_KEYS, ...NPM_CONFIG_KEYS]) {
      expectKeyAbsent(normalized, key);
    }
  });

  it("blocks every forbidden key with explicit undefined overrides", () => {
    const built = buildPlaywrightWebServerEnv(fakeParentEnv());
    for (const key of FORBIDDEN_WEBSERVER_ENV_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(built, key)).toBe(true);
      expect(built[key]).toBeUndefined();
    }
    for (const key of PLAYWRIGHT_CONTROLLER_ONLY_KEYS) {
      expect(built[key]).toBeUndefined();
    }
    for (const key of PLAYWRIGHT_DEFAULT_SUPPRESSED_KEYS) {
      expect(built[key]).toBeUndefined();
    }
  });

  it("maps QA secret to server-only SUPABASE_SERVICE_ROLE_KEY for OTP server functions", () => {
    const normalized = getEffectiveNormalizedChildEnv(fakeParentEnv());
    expect(normalized.SUPABASE_SERVICE_ROLE_KEY).toBe(FAKE_SECRET);
    expectKeyAbsent(normalized, "QA_SUPABASE_SECRET_KEY");
    expectKeyAbsent(normalized, "SUPABASE_SECRET_KEY");
  });

  it("removes unknown secret-like and mixed-case parent variables after merge", () => {
    const parent = fakeParentEnv();
    const normalized = getEffectiveNormalizedChildEnv(parent);

    for (const key of [...UNKNOWN_SECRET_KEYS, ...FORBIDDEN_WEBSERVER_ENV_KEYS]) {
      expectKeyAbsent(normalized, key);
    }

    expect(normalized.UNRELATED_PARENT_VAR).toBeUndefined();
    expect(normalized.VITE_SUPABASE_URL).toBe(QA_URL);
    expect(normalized.VITE_SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_fake");
    expect(normalized.FAMY_ENV).toBe("qa");
    expect(normalized.QA_E2E_OTP_CAPTURE).toBe("1");
  });

  it("preserves required runtime variables using canonical allowlist casing", () => {
    const parent = fakeParentEnv({ Path: process.env.Path ?? process.env.PATH ?? "C:\\Windows\\System32" });
    const normalized = getEffectiveNormalizedChildEnv(parent);

    expect(normalized.PATH).toBeTruthy();
    expect(normalized.Path).toBeUndefined();
    if (process.platform === "win32") {
      expect(normalized.PATHEXT).toBeTruthy();
      expect(normalized.SystemRoot ?? normalized.SYSTEMROOT).toBeTruthy();
    }
  });

  it("contains only documented application and runtime allowlist keys", () => {
    const normalized = getEffectiveNormalizedChildEnv(fakeParentEnv());
    const approved = new Set(WEBSERVER_APPROVED_CHILD_KEYS.map((key) => normalizeEnvKey(key)));
    for (const key of Object.keys(normalized)) {
      expect(approved.has(normalizeEnvKey(key))).toBe(true);
    }
  });

  it("fails least-privilege assertion when Playwright defaults survive merge", () => {
    const parent = fakeParentEnv();
    const brokenOverride = {
      ...buildPlaywrightWebServerEnv(parent),
      FORCE_COLOR: "1",
    };

    expect(() => assertWebServerEnvLeastPrivilege(parent, brokenOverride)).toThrow(
      /Playwright default key survived suppression: FORCE_COLOR/,
    );
  });

  it("fails least-privilege assertion when an unknown parent variable survives merge", () => {
    const parent = fakeParentEnv();
    const brokenOverride = {
      ...buildPlaywrightWebServerEnv(parent),
      RANDOM_PRIVATE_THING: FAKE_SECRET,
    };

    expect(() => assertWebServerEnvLeastPrivilege(parent, brokenOverride)).toThrow(
      /Unknown parent key survived deny-by-default filter: RANDOM_PRIVATE_THING/,
    );
  });

  it("fails least-privilege assertion when NODE_OPTIONS survives merge", () => {
    const parent = fakeParentEnv();
    const brokenOverride = {
      ...buildPlaywrightWebServerEnv(parent),
      NODE_OPTIONS: "--require=evil",
    };

    expect(() => assertWebServerEnvLeastPrivilege(parent, brokenOverride)).toThrow(
      /Blocked runtime key survived Playwright env merge: NODE_OPTIONS/,
    );
  });

  it("passes least-privilege assertion on effective merged child env", () => {
    const parent = fakeParentEnv();
    expect(() => assertWebServerEnvLeastPrivilege(parent)).not.toThrow();
  });

  it("proves blocked and unknown keys are absent in an actual spawned Node child", () => {
    const parent = fakeParentEnv();
    const childEnv = getEffectiveNormalizedChildEnv(parent);

    const probeKeys = JSON.stringify([
      ...UNKNOWN_SECRET_KEYS,
      ...FORBIDDEN_WEBSERVER_ENV_KEYS,
      ...RUNTIME_BLOCKED_EXACT_KEYS,
      ...NPM_CONFIG_KEYS,
      ...PLAYWRIGHT_DEFAULT_SUPPRESSED_KEYS,
      "UNRELATED_PARENT_VAR",
      "aws_secret_access_key",
      "github_token",
      "vercel_automation_bypass_secret",
    ]);
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `const blocked=${probeKeys}; const present=blocked.filter((k)=>Object.prototype.hasOwnProperty.call(process.env,k)); console.log(JSON.stringify({blockedPresent:present.length>0,presentCount:present.length,hasQaUrl:!!process.env.VITE_SUPABASE_URL,hasPath:!!process.env.PATH,hasFamyEnv:process.env.FAMY_ENV==="qa"}));`,
      ],
      { env: childEnv, encoding: "utf8" },
    );

    expect(child.status).toBe(0);
    const result = JSON.parse(child.stdout.trim()) as {
      blockedPresent: boolean;
      presentCount: number;
      hasQaUrl: boolean;
      hasPath: boolean;
      hasFamyEnv: boolean;
    };

    expect(result.blockedPresent).toBe(false);
    expect(result.presentCount).toBe(0);
    expect(result.hasQaUrl).toBe(true);
    expect(result.hasPath).toBe(true);
    expect(result.hasFamyEnv).toBe(true);
    expect(child.stderr).not.toMatch(FAKE_SECRET);
    expect(child.stdout).not.toMatch(FAKE_SECRET);
  });

  it("proves npm and node can start with sanitized child env on this platform", () => {
    const parent = fakeParentEnv();
    const childEnv = getEffectiveNormalizedChildEnv(parent);

    const nodeVersion = spawnSync(process.execPath, ["--version"], {
      env: childEnv,
      encoding: "utf8",
    });
    expect(nodeVersion.status).toBe(0);
    expect(nodeVersion.stdout.trim()).toMatch(/^v\d+/);

    const npmVersion = process.platform === "win32"
      ? spawnSync(childEnv.COMSPEC ?? "cmd.exe", ["/d", "/s", "/c", "npm --version"], {
          env: childEnv,
          encoding: "utf8",
        })
      : spawnSync("npm", ["--version"], {
          env: childEnv,
          encoding: "utf8",
        });

    expect(npmVersion.status).toBe(0);
    expect(npmVersion.stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
    expect(npmVersion.stderr).not.toMatch(FAKE_SECRET);
    expect(npmVersion.stdout).not.toMatch(FAKE_SECRET);
  });

  it("keeps only approved application keys from the explicit allowlist", () => {
    const normalized = getEffectiveNormalizedChildEnv(fakeParentEnv());
    for (const key of WEBSERVER_APPLICATION_ALLOWLIST) {
      expect(normalized[key]).toBeDefined();
    }
  });
});

describe("playwright webServer legacy merge helpers", () => {
  it("normalizes undefined overrides out of merged env objects", () => {
    const normalized = normalizeChildProcessEnv(
      mergePlaywrightChildEnv({ KEEP: "yes", DROP: "secret" }, { DROP: undefined, ADD: "ok" }),
    );
    expect(normalized.KEEP).toBe("yes");
    expect(normalized.ADD).toBe("ok");
    expect(normalized.DROP).toBeUndefined();
  });

  it("documents Playwright default constants used in merge simulation", () => {
    expect(PLAYWRIGHT_DEFAULT_ENVIRONMENT_VARIABLES).toEqual({
      BROWSER: "none",
      FORCE_COLOR: "1",
      DEBUG_COLORS: "1",
    });
  });
});
