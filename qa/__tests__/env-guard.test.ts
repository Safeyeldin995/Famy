import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  collectQaGuardErrors,
  normalizeAppOrigin,
  validateQaEnvironment,
  validateUiDatabaseAlignment,
} from "../env-guard.mjs";
import {
  KNOWN_PRODUCTION_PROJECT_REF,
  KNOWN_QA_PROJECT_REF,
} from "../qa-identity.mjs";
import {
  isDestructiveCleanupEligible,
  isDeterministicQaEmail,
} from "../qa-classification.mjs";
import { assessDestructiveCleanupEligibility } from "../teardown-core.mjs";
import { parseCleanupArgs } from "../cleanup-args.mjs";
import {
  assertWebServerEnvLeastPrivilege,
  buildPlaywrightWebServerEnv,
  FORBIDDEN_WEBSERVER_ENV_KEYS,
  mergePlaywrightChildEnv,
  normalizeChildProcessEnv,
} from "../playwright-webserver-env.mjs";
import { parseEnvFile } from "../load-qa-env.mjs";
import {
  assertRuntimeIdentityMatchesQaGuard,
  validateRuntimeIdentityPayload,
} from "../runtime-identity-fetch.mjs";
import { handleQaMetaRequest } from "../runtime-identity-build.mjs";
import { registryHasPendingOrphans } from "../orphan-recovery.mjs";

const QA_URL = `https://${KNOWN_QA_PROJECT_REF}.supabase.co`;
const PROD_URL = `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`;

function validQaEnv(overrides = {}) {
  return {
    FAMY_ENV: "qa",
    FAMY_QA_SUPABASE_PROJECT_REF: KNOWN_QA_PROJECT_REF,
    FAMY_PRODUCTION_SUPABASE_PROJECT_REF: KNOWN_PRODUCTION_PROJECT_REF,
    QA_SUPABASE_URL: QA_URL,
    QA_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    QA_SUPABASE_SECRET_KEY: "sb_secret_test",
    FAMY_QA_APP_ORIGIN: "http://localhost:8099",
    FAMY_PRODUCTION_APP_ORIGIN: "https://famy-chi.vercel.app",
    ...overrides,
  };
}

describe("authoritative QA identity anchoring", () => {
  it("passes when URL and env refs match known QA project", () => {
    expect(() => validateQaEnvironment(validQaEnv())).not.toThrow();
  });

  it("always fails when QA URL resolves to known Production ref", () => {
    const errors = collectQaGuardErrors(validQaEnv({
      QA_SUPABASE_URL: PROD_URL,
      FAMY_QA_SUPABASE_PROJECT_REF: KNOWN_QA_PROJECT_REF,
      FAMY_PRODUCTION_SUPABASE_PROJECT_REF: KNOWN_PRODUCTION_PROJECT_REF,
    }));
    expect(errors.some((e) => e.includes("known QA project ref"))).toBe(true);
    expect(errors.some((e) => e.includes("Refusing known Production"))).toBe(true);
  });

  it("fails when Production URL is paired with mistyped Production env ref", () => {
    const errors = collectQaGuardErrors(validQaEnv({
      QA_SUPABASE_URL: PROD_URL,
      FAMY_QA_SUPABASE_PROJECT_REF: KNOWN_QA_PROJECT_REF,
      FAMY_PRODUCTION_SUPABASE_PROJECT_REF: "wrongprodref12345",
    }));
    expect(errors.some((e) => e.includes("known Production project ref"))).toBe(true);
    expect(errors.some((e) => e.includes("known QA project ref"))).toBe(true);
  });

  it("fails when QA allowlist env ref is wrong", () => {
    const errors = collectQaGuardErrors(validQaEnv({
      FAMY_QA_SUPABASE_PROJECT_REF: "wrongqaref123456",
    }));
    expect(errors.some((e) => e.includes("known QA project ref"))).toBe(true);
  });

  it("fails when Production denylist env ref is wrong", () => {
    const errors = collectQaGuardErrors(validQaEnv({
      FAMY_PRODUCTION_SUPABASE_PROJECT_REF: "wrongprodref12345",
    }));
    expect(errors.some((e) => e.includes("known Production project ref"))).toBe(true);
  });
});

describe("destructive cleanup eligibility", () => {
  it("rejects registry-only real user signals", () => {
    expect(isDestructiveCleanupEligible({
      email: "real.user@example.com",
      fullName: "Real User",
      inRegistry: true,
    })).toBe(false);
  });

  it("rejects phone-* without QA profile even in registry", () => {
    expect(isDestructiveCleanupEligible({
      email: "phone-201012345678@famio.local",
      fullName: "Real Name",
      inRegistry: true,
    })).toBe(false);
  });

  it("accepts registry-tracked phone QA user with QA profile", () => {
    expect(isDestructiveCleanupEligible({
      email: "phone-201012345678@famio.local",
      fullName: "QA_adminSeed_e2e",
      inRegistry: true,
    })).toBe(true);
  });

  it("accepts deterministic qa-* fixture", () => {
    expect(isDeterministicQaEmail("qa-address-admin-1@famio.local")).toBe(true);
    expect(isDestructiveCleanupEligible({
      email: "qa-address-admin-1@famio.local",
      inRegistry: false,
    })).toBe(true);
  });

  it("reassesses registry membership independently in assessDestructiveCleanupEligibility", async () => {
    const admin = {
      auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: "real.user@example.com" } } })) } },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { full_name: "Real User" } })),
          })),
        })),
      })),
    };

    const registryIds = new Set(["user-real-0001"]);
    const result = await assessDestructiveCleanupEligibility(admin, "user-real-0001", registryIds);
    expect(result.eligible).toBe(false);
    expect(result.inRegistry).toBe(true);
  });
});

describe("runtime identity endpoint validation", () => {
  it("builds QA meta response from runtime Supabase URL", () => {
    const response = handleQaMetaRequest(new Request("http://localhost:8099/__qa/meta"), {
      VITE_SUPABASE_URL: QA_URL,
    });
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects non-GET methods on the meta endpoint", () => {
    const response = handleQaMetaRequest(new Request("http://localhost:8099/__qa/meta", { method: "POST" }), {
      VITE_SUPABASE_URL: QA_URL,
    });
    expect(response?.status).toBe(405);
  });

  it("validates runtime identity payload schema", () => {
    expect(validateRuntimeIdentityPayload({
      environment: "qa",
      supabaseProjectRef: KNOWN_QA_PROJECT_REF,
    })).toEqual({ environment: "qa", supabaseProjectRef: KNOWN_QA_PROJECT_REF });
  });

  it("rejects production runtime identity for QA guard", () => {
    expect(() => assertRuntimeIdentityMatchesQaGuard({
      environment: "production",
      supabaseProjectRef: KNOWN_PRODUCTION_PROJECT_REF,
    }, KNOWN_QA_PROJECT_REF)).toThrow(/must be "qa"/);
  });

  it("rejects mismatched deployed and node refs", () => {
    expect(() => assertRuntimeIdentityMatchesQaGuard({
      environment: "qa",
      supabaseProjectRef: KNOWN_QA_PROJECT_REF,
    }, "differentref123456")).toThrow(/does not match the guarded Node QA ref/);
  });
});

describe("cleanup argument parsing", () => {
  it("defaults to dry-run with no args", () => {
    expect(parseCleanupArgs([])).toEqual({ mode: "dry-run", confirmValue: undefined });
  });

  it("rejects execute without confirmation", () => {
    expect(parseCleanupArgs(["--execute"]).mode).toBe("rejected");
  });

  it("rejects wrong confirmation value", () => {
    expect(parseCleanupArgs(["--execute", "--confirm=WRONG"]).mode).toBe("rejected");
  });

  it("allows execute only with exact confirmation", () => {
    expect(parseCleanupArgs(["--execute", "--confirm=I-UNDERSTAND-QA-CLEANUP"])).toEqual({
      mode: "execute",
      confirmValue: "I-UNDERSTAND-QA-CLEANUP",
    });
  });

  it("rejects unknown dangerous flags", () => {
    expect(parseCleanupArgs(["--force"]).mode).toBe("rejected");
  });
});

describe("playwright webServer least privilege", () => {
  it("deny-by-default removes inherited secrets and unknown parent keys", () => {
    const parent = Object.freeze({
      QA_SUPABASE_URL: QA_URL,
      QA_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      QA_SUPABASE_SECRET_KEY: "sb_secret_test",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
      RANDOM_PRIVATE_THING: "sb_secret_test",
      ...Object.fromEntries(
        ["PATH"].map((key) => [key, process.env[key] ?? "C:\\Windows\\System32"]),
      ),
    });
    const webServerEnv = buildPlaywrightWebServerEnv(parent);
    const normalized = normalizeChildProcessEnv(mergePlaywrightChildEnv(parent, webServerEnv));

    for (const key of FORBIDDEN_WEBSERVER_ENV_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(normalized, key)).toBe(false);
    }
    expect(Object.prototype.hasOwnProperty.call(normalized, "RANDOM_PRIVATE_THING")).toBe(false);

    assertWebServerEnvLeastPrivilege(parent, webServerEnv);
    expect(normalized.VITE_SUPABASE_URL).toBe(QA_URL);
  });
});

describe("origin normalization", () => {
  it("normalizes case, default ports, and trailing slash", () => {
    expect(normalizeAppOrigin("HTTPS://LocalHost:8099/")).toBe("https://localhost:8099");
    expect(normalizeAppOrigin("http://LOCALHOST:80")).toBe("http://localhost");
    expect(normalizeAppOrigin("https://example.com:443/")).toBe("https://example.com");
  });

  it("rejects credentials and paths", () => {
    expect(() => normalizeAppOrigin("https://user:pass@localhost:8099")).toThrow(/credentials/);
    expect(() => normalizeAppOrigin("https://localhost:8099/admin")).toThrow(/path/);
  });

  it("preserves non-default ports", () => {
    expect(normalizeAppOrigin("http://localhost:8099")).toBe("http://localhost:8099");
  });
});

describe("env file parser", () => {
  it("parses CRLF, quotes, comments, embedded equals, and blank values", () => {
    const parsed = parseEnvFile([
      "# comment",
      " FAMY_ENV = qa ",
      'QA_KEY="value with = inside"',
      "BLANK=",
      "HASH_IN_QUOTES=\"value # still value\"",
      "SINGLE='single-quoted'",
    ].join("\r\n"));
    expect(parsed.FAMY_ENV).toBe("qa");
    expect(parsed.QA_KEY).toBe("value with = inside");
    expect(parsed.BLANK).toBe("");
    expect(parsed.HASH_IN_QUOTES).toBe("value # still value");
    expect(parsed.SINGLE).toBe("single-quoted");
  });

  it("loads from a temporary file without printing values", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-env-test-"));
    const file = path.join(dir, ".env.qa.local");
    fs.writeFileSync(file, `FAMY_ENV=qa\nSECRET=test-value\n`, "utf8");
    const parsed = parseEnvFile(fs.readFileSync(file, "utf8"));
    expect(parsed.SECRET).toBe("test-value");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("registry orphan lifecycle", () => {
  const registryPath = path.resolve(process.cwd(), "qa/.auth/registry.json");

  afterEach(() => {
    try {
      fs.unlinkSync(registryPath);
    } catch {
      // ignore
    }
  });

  it("detects pending registry orphans without erasing first", () => {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify({ users: [{ userId: "abc-123", key: "customer" }] }));
    expect(registryHasPendingOrphans()).toBe(true);
    fs.writeFileSync(registryPath, JSON.stringify({ users: [] }));
    expect(registryHasPendingOrphans()).toBe(false);
  });
});

describe("runTeardownForUserIds destructive revalidation", () => {
  it("accepts valid qa-* fixture and rejects real user even when registry contains the id", async () => {
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async (userId: string) => ({
            data: {
              user: userId === "good-user-001"
                ? { email: "qa-fixture-1@famio.local" }
                : { email: "real.user@example.com" },
            },
          })),
        },
      },
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn((column: string, userId: string) => ({
            maybeSingle: vi.fn(async () => ({
              data: table === "profiles"
                ? {
                    full_name: userId === "good-user-001" ? "QA_customer_e2e" : "Real User",
                  }
                : null,
            })),
          })),
        })),
      })),
    };

    const { runTeardownForUserIds } = await import("../teardown-core.mjs");
    const result = await runTeardownForUserIds(admin, ["good-user-001", "bad-user-0002"], {
      execute: false,
      registryIds: ["good-user-001", "bad-user-0002"],
    });

    expect(result.succeeded).toEqual(["good-user-001"]);
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0].userId).toBe("bad-user-0002");
  });
});

describe("fetchRuntimeIdentity validation (mocked, network-free)", () => {
  it("rejects redirect responses", async () => {
    const { fetchRuntimeIdentity } = await import("../runtime-identity-fetch.mjs");
    const fetchImpl = vi.fn(async () => new Response("", { status: 302, headers: { Location: "https://evil.example" } }));
    await expect(fetchRuntimeIdentity("http://localhost:8099", {}, fetchImpl)).rejects.toThrow(/redirected/);
  });

  it("accepts valid QA identity payload from mocked fetch", async () => {
    const { fetchRuntimeIdentity } = await import("../runtime-identity-fetch.mjs");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      environment: "qa",
      supabaseProjectRef: KNOWN_QA_PROJECT_REF,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const payload = await fetchRuntimeIdentity("http://localhost:8099/", {}, fetchImpl);
    expect(payload).toEqual({ environment: "qa", supabaseProjectRef: KNOWN_QA_PROJECT_REF });
  });
});

describe("list-users pagination", () => {
  it("follows all pages beyond 200 users", async () => {
    const { listAllAuthUsers } = await import("../list-users-paginated.mjs");
    let pageCalls = 0;
    const admin = {
      auth: {
        admin: {
          listUsers: vi.fn(async ({ page, perPage }) => {
            pageCalls += 1;
            if (page === 1) {
              return { data: { users: Array.from({ length: perPage }, (_, i) => ({ id: `u${i}` })) }, error: null };
            }
            if (page === 2) {
              return { data: { users: [{ id: "u200" }] }, error: null };
            }
            return { data: { users: [] }, error: null };
          }),
        },
      },
    };
    const users = await listAllAuthUsers(admin);
    expect(users).toHaveLength(201);
    expect(pageCalls).toBe(2);
  });
});
