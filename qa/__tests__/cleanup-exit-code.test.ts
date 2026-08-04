import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateCleanupExecuteOutcome,
} from "../teardown-core.mjs";

const REPO_ROOT = process.cwd();
const FAKE_FINGERPRINT = "b".repeat(64);

function emptyHonestMetrics() {
  return {
    active_operational_residue: 0,
    retained_immutable_history: 0,
    terminal_disabled_identities: 0,
    deletable_QA_resources: 0,
    protected_seed_data: 0,
  };
}

function baseUsers(overrides: Record<string, unknown> = {}) {
  return {
    succeeded: [],
    refused: [],
    failed: [],
    retained: [],
    resourceFailures: [],
    coOwnedFailures: [],
    aborted: false,
    ...overrides,
  };
}

function evaluate(overrides: {
  users?: ReturnType<typeof baseUsers>;
  honestMetrics?: ReturnType<typeof emptyHonestMetrics>;
  recoveryCount?: number;
  remainingCandidates?: number;
  aborted?: boolean;
  plan?: { retained: Array<{ table: string; reason: string }> };
} = {}) {
  return evaluateCleanupExecuteOutcome({
    plan: overrides.plan ?? { retained: [] },
    users: overrides.users ?? baseUsers(),
    honestMetrics: overrides.honestMetrics ?? emptyHonestMetrics(),
    recoveryCount: overrides.recoveryCount ?? 0,
    remainingCandidates: overrides.remainingCandidates ?? 0,
    aborted: overrides.aborted ?? false,
  });
}

function cleanupModuleUrl() {
  return pathToFileURL(path.join(REPO_ROOT, "qa/cleanup.mjs")).href;
}

function isolatedEnv() {
  const env = { ...process.env, FAMY_ENV: "qa" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("QA_SUPABASE_") || key.startsWith("SUPABASE_")) {
      delete env[key];
    }
  }
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  delete env.VITEST_QA_UNIT_GUARD;
  return env;
}

describe("evaluateCleanupExecuteOutcome", () => {
  it("returns success for complete execute success", () => {
    const outcome = evaluate({
      users: baseUsers({ succeeded: ["user-a"] }),
    });
    expect(outcome.success).toBe(true);
    expect(outcome.zeroBaselineAchieved).toBe(true);
    expect(outcome.failureReasons).toEqual([]);
  });

  it("returns failure for failed users", () => {
    const outcome = evaluate({
      users: baseUsers({ failed: [{ userId: "user-a", reason: "delete-failed" }] }),
    });
    expect(outcome.success).toBe(false);
    expect(outcome.failureReasons.some((row) => row.startsWith("failed_users="))).toBe(true);
  });

  it("returns failure for refused users", () => {
    const outcome = evaluate({
      users: baseUsers({ refused: [{ userId: "user-a", reason: "insufficient-qa-signals" }] }),
    });
    expect(outcome.success).toBe(false);
    expect(outcome.failureReasons.some((row) => row.startsWith("refused_users="))).toBe(true);
  });

  it("returns failure for retained users", () => {
    const outcome = evaluate({
      users: baseUsers({ retained: [{ userId: "user-a", reason: "terminal_disabled" }] }),
    });
    expect(outcome.success).toBe(false);
    expect(outcome.failureReasons.some((row) => row.startsWith("retained_users="))).toBe(true);
  });

  it("returns failure for resource failures", () => {
    const outcome = evaluate({
      users: baseUsers({
        resourceFailures: [{ resourceKey: "services:svc-1", table: "services", reason: "resource-delete-failed" }],
      }),
    });
    expect(outcome.success).toBe(false);
    expect(outcome.failureReasons.some((row) => row.startsWith("resource_failures="))).toBe(true);
  });

  it("returns failure when zero-baseline is not achieved", () => {
    const outcome = evaluate({
      honestMetrics: {
        ...emptyHonestMetrics(),
        active_operational_residue: 2,
      },
      recoveryCount: 1,
      remainingCandidates: 1,
    });
    expect(outcome.success).toBe(false);
    expect(outcome.zeroBaselineAchieved).toBe(false);
    expect(outcome.failureReasons.some((row) => row.startsWith("active_operational_residue="))).toBe(true);
    expect(outcome.failureReasons.some((row) => row.startsWith("recovery_entries="))).toBe(true);
    expect(outcome.failureReasons.some((row) => row.startsWith("remaining_candidates="))).toBe(true);
  });

  it("returns failure for aborted execute", () => {
    const outcome = evaluate({ aborted: true });
    expect(outcome.success).toBe(false);
    expect(outcome.aborted).toBe(true);
    expect(outcome.failureReasons).toContain("aborted");
  });
});

describe("cleanup CLI exit propagation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns exit 0 for dry-run success", async () => {
    vi.doMock("../teardown-core.mjs", () => ({
      runTeardownDryRun: vi.fn(async () => ({ fingerprint: FAKE_FINGERPRINT })),
      runTeardown: vi.fn(),
    }));
    vi.doMock("../load-qa-env.mjs", () => ({
      loadQaEnv: vi.fn(),
      configureQaEnvFilePathForTests: vi.fn(),
      resetQaEnvFilePathForTests: vi.fn(),
    }));
    vi.doMock("../env-guard.mjs", () => ({
      runPreflightChecks: vi.fn(),
    }));

    const { main } = await import("../cleanup.mjs");
    const code = await main([]);
    expect(code).toBe(0);
  });

  it("returns exit 0 for complete execute success", async () => {
    vi.doMock("../teardown-core.mjs", () => ({
      runTeardownDryRun: vi.fn(),
      runTeardown: vi.fn(async () => ({
        success: true,
        aborted: false,
        zeroBaselineAchieved: true,
        failureReasons: [],
      })),
    }));
    vi.doMock("../load-qa-env.mjs", () => ({
      loadQaEnv: vi.fn(),
    }));
    vi.doMock("../env-guard.mjs", () => ({
      runPreflightChecks: vi.fn(),
    }));

    const { main } = await import("../cleanup.mjs");
    const code = await main([
      "--execute",
      "--confirm=I-UNDERSTAND-QA-CLEANUP",
      `--plan-fingerprint=${FAKE_FINGERPRINT}`,
    ]);
    expect(code).toBe(0);
  });

  it("returns exit 1 for incomplete execute", async () => {
    vi.doMock("../teardown-core.mjs", () => ({
      runTeardownDryRun: vi.fn(),
      runTeardown: vi.fn(async () => ({
        success: false,
        aborted: false,
        zeroBaselineAchieved: false,
        failureReasons: ["retained_users=1"],
      })),
    }));
    vi.doMock("../load-qa-env.mjs", () => ({
      loadQaEnv: vi.fn(),
    }));
    vi.doMock("../env-guard.mjs", () => ({
      runPreflightChecks: vi.fn(),
    }));

    const { main } = await import("../cleanup.mjs");
    const code = await main([
      "--execute",
      "--confirm=I-UNDERSTAND-QA-CLEANUP",
      `--plan-fingerprint=${FAKE_FINGERPRINT}`,
    ]);
    expect(code).toBe(1);
  });

  it("returns exit 1 for aborted execute", async () => {
    vi.doMock("../teardown-core.mjs", () => ({
      runTeardownDryRun: vi.fn(),
      runTeardown: vi.fn(async () => ({
        success: false,
        aborted: true,
        zeroBaselineAchieved: false,
        failureReasons: ["aborted"],
      })),
    }));
    vi.doMock("../load-qa-env.mjs", () => ({
      loadQaEnv: vi.fn(),
    }));
    vi.doMock("../env-guard.mjs", () => ({
      runPreflightChecks: vi.fn(),
    }));

    const { main } = await import("../cleanup.mjs");
    const code = await main([
      "--execute",
      "--confirm=I-UNDERSTAND-QA-CLEANUP",
      `--plan-fingerprint=${FAKE_FINGERPRINT}`,
    ]);
    expect(code).toBe(1);
  });

  it("propagates execute failure through native subprocess main()", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cleanup-exit-"));
    const failScript = `
      process.chdir(${JSON.stringify(tmpDir)});
      const { main } = await import(${JSON.stringify(cleanupModuleUrl())});
      const code = await main([
        "--execute",
        "--confirm=I-UNDERSTAND-QA-CLEANUP",
        "--plan-fingerprint=${FAKE_FINGERPRINT}",
      ]);
      console.log("EXIT:" + code);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", failScript], {
      cwd: REPO_ROOT,
      env: isolatedEnv(),
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("EXIT:1");
    expect(result.stderr).toMatch(/Missing \.env\.qa\.local/);
  });
});
