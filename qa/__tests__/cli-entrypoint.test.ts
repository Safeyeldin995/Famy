import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseContainmentArgs, CONTAINMENT_CONFIRM_VALUE } from "../containment-args.mjs";
import { isDirectExecution } from "../cli-entrypoint.mjs";
import { main as runWithQaEnvMain } from "../run-with-qa-env.mjs";
import {
  assertQaCliGuards,
  auditQaEntrypoints,
  QA_CLI_GUARD_REQUIRED,
} from "../entrypoint-audit.mjs";
import {
  configureRegistryRootForTests,
  registerUserEntry,
  resetRegistryRootForTests,
} from "../registry.mjs";
import { useIsolatedRegistry } from "./registry-test-harness.ts";

const REPO_ROOT = process.cwd();
const FAKE_FINGERPRINT = "a".repeat(64);

function cleanupModuleUrl() {
  return pathToFileURL(path.join(REPO_ROOT, "qa/cleanup.mjs")).href;
}

function preflightModuleUrl() {
  return pathToFileURL(path.join(REPO_ROOT, "qa/preflight.mjs")).href;
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
  return env;
}

function spawnNodeEval(source: string, tmpDir: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: REPO_ROOT,
    env: isolatedEnv(),
    encoding: "utf8",
    timeout: 30_000,
  });
}

function listCreatedPaths(root: string) {
  if (!fs.existsSync(root)) return [];
  /** @type {string[]} */
  const found = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      found.push(full);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return found;
}

describe("cli entrypoint guards", () => {
  it("classifies every qa root mjs module", () => {
    const rows = auditQaEntrypoints(path.join(REPO_ROOT, "qa"));
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) {
      expect(row.classification).toBeTruthy();
      if (row.guardRequired) {
        expect(row.hasGuard).toBe(true);
        expect(row.hasExportedMain).toBe(true);
      }
    }
    expect(() => assertQaCliGuards(path.join(REPO_ROOT, "qa"))).not.toThrow();
    expect(QA_CLI_GUARD_REQUIRED).toEqual([
      "cleanup.mjs",
      "containment.mjs",
      "preflight.mjs",
      "verify-residue.mjs",
      "run-with-qa-env.mjs",
      "verify-onboarding-privileges.mjs",
    ]);
  });

  it("isDirectExecution is false for import.meta.url with fake argv entry", () => {
    expect(isDirectExecution(import.meta.url, ["node", "other-script.mjs"])).toBe(false);
  });
});

describe("native subprocess import safety", () => {
  it("importing cleanup.mjs exits 0 without side effects", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cli-import-"));
    const script = `
      process.chdir(${JSON.stringify(tmpDir)});
      process.argv = ["node", "ignored-entry.mjs"];
      await import(${JSON.stringify(cleanupModuleUrl())});
      console.log("IMPORT_OK");
    `;
    const result = spawnNodeEval(script, tmpDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IMPORT_OK");
    expect(result.stderr).toBe("");
    expect(listCreatedPaths(tmpDir)).toEqual([]);
  });

  it("importing containment.mjs ignores ambient destructive argv", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-containment-import-"));
    const script = `
      process.chdir(${JSON.stringify(tmpDir)});
      process.argv = [
        "node",
        "ignored-entry.mjs",
        "--execute",
        "--confirm=${CONTAINMENT_CONFIRM_VALUE}",
        "--plan-fingerprint=${FAKE_FINGERPRINT}",
      ];
      await import(${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, "qa/containment.mjs")).href)});
      console.log("IMPORT_OK");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: REPO_ROOT,
      env: isolatedEnv(),
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IMPORT_OK");
    expect(listCreatedPaths(tmpDir)).toEqual([]);
  });

  it("importing cleanup.mjs ignores ambient destructive argv", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cli-import-"));
    const script = `
      process.chdir(${JSON.stringify(tmpDir)});
      process.argv = [
        "node",
        "ignored-entry.mjs",
        "--execute",
        "--confirm=I-UNDERSTAND-QA-CLEANUP",
        "--plan-fingerprint=${FAKE_FINGERPRINT}",
      ];
      await import(${JSON.stringify(cleanupModuleUrl())});
      console.log("IMPORT_OK");
    `;
    const result = spawnNodeEval(script, tmpDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IMPORT_OK");
    expect(result.stderr).toBe("");
    expect(listCreatedPaths(tmpDir)).toEqual([]);
  });

  it("importing preflight.mjs and run-with-qa-env.mjs perform zero actions", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cli-import-"));
    const script = `
      process.chdir(${JSON.stringify(tmpDir)});
      process.argv = ["node", "ignored-entry.mjs", "node", "--version"];
      await import(${JSON.stringify(preflightModuleUrl())});
      await import(${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, "qa/run-with-qa-env.mjs")).href)});
      console.log("IMPORT_OK");
    `;
    const result = spawnNodeEval(script, tmpDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IMPORT_OK");
    expect(listCreatedPaths(tmpDir)).toEqual([]);
  });

  it("exported cleanup main fails closed before network on missing QA env", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-main-test-"));
    const script = `
      process.chdir(${JSON.stringify(tmpDir)});
      const { main } = await import(${JSON.stringify(cleanupModuleUrl())});
      const code = await main([
        "--execute",
        "--confirm=I-UNDERSTAND-QA-CLEANUP",
        "--plan-fingerprint=${FAKE_FINGERPRINT}",
      ]);
      console.log("EXIT:" + code);
    `;
    const result = spawnNodeEval(script, tmpDir);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("EXIT:1");
    expect(result.stderr).toMatch(/Missing \.env\.qa\.local/);
    expect(listCreatedPaths(tmpDir)).toEqual([]);
  });

  it("exported run-with-qa-env main fails closed without child args", () => {
    const code = runWithQaEnvMain([]);
    expect(code).toBe(1);
  });
});

describe("registry write isolation under tests", () => {
  useIsolatedRegistry();

  it("allows writes when an isolated registry root is configured", () => {
    expect(() => registerUserEntry({ userId: "isolated-user", email: "qa@famio.local" })).not.toThrow();
  });

  it("throws when tests write without an isolated registry root", () => {
    resetRegistryRootForTests();
    expect(() => registerUserEntry({ userId: "blocked-user", email: "qa@famio.local" }))
      .toThrow(/configureRegistryRootForTests|enableGuardedIntegrationRegistryMode/);
  });
});
