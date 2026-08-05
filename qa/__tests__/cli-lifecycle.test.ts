import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { finishCliProcess } from "../cli-entrypoint.mjs";
import { spawnChildAndWait } from "../spawn-child.mjs";
import { buildFakeQaEnvFileContent } from "./qa-env-test-harness.ts";

const REPO_ROOT = process.cwd();
const VERIFY_RESIDUE_URL = pathToFileURL(path.join(REPO_ROOT, "qa/verify-residue.mjs")).href;
const RUN_WITH_QA_ENV_URL = pathToFileURL(path.join(REPO_ROOT, "qa/run-with-qa-env.mjs")).href;
const CLI_ENTRYPOINT_URL = pathToFileURL(path.join(REPO_ROOT, "qa/cli-entrypoint.mjs")).href;

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

function spawnNodeEval(source: string, tmpDir: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: tmpDir,
    env: isolatedEnv(),
    encoding: "utf8",
    timeout: 30_000,
  });
}

function mockSupabaseAdmin(activeServices: boolean) {
  return {
    from: (table: string) => ({
      select: () => ({
        ilike: () => ({
          eq: async () => ({
            data: activeServices && table === "services" ? [{ id: "svc", name_en: "QA_test" }] : [],
          }),
          or: async () => ({ data: [] }),
          in: async () => ({ data: [] }),
        }),
      }),
    }),
  };
}

describe("cli lifecycle shutdown", () => {
  it("finishCliProcess sets exitCode after draining network io", async () => {
    await finishCliProcess(0);
    expect(process.exitCode).toBe(0);
  });

  it("finishCliProcess exits cleanly after async fetch work on Windows", () => {
    const script = `
      const { finishCliProcess } = await import(${JSON.stringify(CLI_ENTRYPOINT_URL)});
      await fetch("https://example.com").catch(() => {});
      await finishCliProcess(0);
    `;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-finish-fetch-"));
    const result = spawnNodeEval(script, tmpDir);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/UV_HANDLE_CLOSING/);
  });

  it("wrapper propagates unexpected child failure as non-zero", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-spawn-fail-"));
    const childScript = path.join(tmpDir, "child-fail.mjs");
    fs.writeFileSync(childScript, `process.exit(42);`);

    const code = await spawnChildAndWait(process.execPath, [childScript], {
      ...process.env,
      NODE_OPTIONS: "",
    });

    expect(code).toBe(42);
  });

  it("spawnChildAndWait resolves only after child close", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-spawn-close-"));
    const marker = path.join(tmpDir, "marker.log");
    const childScript = path.join(tmpDir, "child.mjs");
    fs.writeFileSync(childScript, `
      import fs from "node:fs";
      fs.appendFileSync(${JSON.stringify(marker)}, "start\\n");
      await new Promise((resolve) => setTimeout(resolve, 50));
      fs.appendFileSync(${JSON.stringify(marker)}, "end\\n");
    `);

    const code = await spawnChildAndWait(process.execPath, [childScript], {
      ...process.env,
      NODE_OPTIONS: "",
    });

    expect(code).toBe(0);
    expect(fs.readFileSync(marker, "utf8")).toBe("start\nend\n");
  });

  it("spawnChildAndWait does not resolve twice on close", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-spawn-once-"));
    const childScript = path.join(tmpDir, "child-once.mjs");
    fs.writeFileSync(childScript, `process.exit(0);`);

    const results = await Promise.all([
      spawnChildAndWait(process.execPath, [childScript], { ...process.env, NODE_OPTIONS: "" }),
      spawnChildAndWait(process.execPath, [childScript], { ...process.env, NODE_OPTIONS: "" }),
    ]);

    expect(results).toEqual([0, 0]);
  });

  it("run-with-qa-env main fails closed without child args and does not spawn", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-run-main-empty-"));
    const script = `
      const { main } = await import(${JSON.stringify(RUN_WITH_QA_ENV_URL)});
      const code = await main([]);
      console.log("EXIT:" + code);
    `;
    const result = spawnNodeEval(script, tmpDir);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("EXIT:1");
  });

  it("run-with-qa-env wrapper waits for child close before exiting cleanly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-wrapper-close-"));
    fs.writeFileSync(path.join(tmpDir, ".env.qa.local"), [
      "FAMY_ENV=qa",
      "FAMY_QA_SUPABASE_PROJECT_REF=bfwveoqbyqlhixjvdzha",
      "FAMY_PRODUCTION_SUPABASE_PROJECT_REF=mjhkaiabfnzewprcnojp",
      "QA_SUPABASE_URL=https://bfwveoqbyqlhixjvdzha.supabase.co",
      "QA_SUPABASE_PUBLISHABLE_KEY=test-publishable-key",
      "QA_SUPABASE_SECRET_KEY=test-secret-key",
      "FAMY_QA_APP_ORIGIN=http://localhost:5173",
      "FAMY_PRODUCTION_APP_ORIGIN=https://example.com",
      "",
    ].join("\n"));
    const childScript = path.join(tmpDir, "child-wrapper.mjs");
    fs.writeFileSync(childScript, `
      import fs from "node:fs";
      fs.appendFileSync("wrapper-marker.log", "child-done\\n");
    `);

    const script = `
      process.argv = ["node", ${JSON.stringify(path.join(REPO_ROOT, "qa/run-with-qa-env.mjs"))}, ${JSON.stringify(process.execPath)}, ${JSON.stringify(childScript)}];
      await import(${JSON.stringify(RUN_WITH_QA_ENV_URL)});
    `;
    const result = spawnNodeEval(script, tmpDir);
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(tmpDir, "wrapper-marker.log"), "utf8")).toBe("child-done\n");
    expect(result.stderr).not.toMatch(/UV_HANDLE_CLOSING/);
  });

  it("importing verify-residue.mjs performs zero actions", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-verify-residue-import-"));
    const script = `
      process.argv = ["node", "ignored-entry.mjs"];
      await import(${JSON.stringify(VERIFY_RESIDUE_URL)});
      console.log("IMPORT_OK");
    `;
    const result = spawnNodeEval(script, tmpDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IMPORT_OK");
    expect(fs.existsSync(path.join(tmpDir, "qa/report/residue-verify.json"))).toBe(false);
  });

  it("exported verify-residue main fails closed before network on missing QA env", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-verify-residue-env-"));
    const script = `
      const { main } = await import(${JSON.stringify(VERIFY_RESIDUE_URL)});
      try {
        const code = await main();
        console.log("EXIT:" + code);
      } catch (error) {
        console.log("ERROR:" + (error instanceof Error ? error.message : String(error)));
      }
    `;
    const result = spawnNodeEval(script, tmpDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/ERROR:.*Missing \.env\.qa\.local/);
  });
});

describe("verify-residue main with isolated QA env", () => {
  /** @type {string} */
  let envFile = "";

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-residue-main-"));
    envFile = path.join(tmpDir, ".env.qa.local");
    fs.writeFileSync(envFile, buildFakeQaEnvFileContent(), "utf8");
    vi.resetModules();
    const { configureQaEnvFilePathForTests, loadQaEnv } = await import("../load-qa-env.mjs");
    configureQaEnvFilePathForTests(envFile);
    loadQaEnv({ required: true });
  });

  afterEach(async () => {
    vi.doUnmock("../admin-client.mjs");
    vi.resetModules();
    const { resetQaEnvFilePathForTests } = await import("../load-qa-env.mjs");
    resetQaEnvFilePathForTests();
  });

  it("clean verifier main propagates exit 0", async () => {
    vi.resetModules();
    const { configureQaEnvFilePathForTests } = await import("../load-qa-env.mjs");
    configureQaEnvFilePathForTests(envFile);
    vi.doMock("../admin-client.mjs", () => ({
      getSupabaseAdmin: () => mockSupabaseAdmin(false),
      supabaseAdmin: {},
    }));
    const { main } = await import("../verify-residue.mjs");
    await expect(main()).resolves.toBe(0);
  });

  it("residue main propagates exit 1 when active operational residue exists", async () => {
    vi.resetModules();
    const { configureQaEnvFilePathForTests } = await import("../load-qa-env.mjs");
    configureQaEnvFilePathForTests(envFile);
    vi.doMock("../admin-client.mjs", () => ({
      getSupabaseAdmin: () => mockSupabaseAdmin(true),
      supabaseAdmin: {},
    }));
    const { main } = await import("../verify-residue.mjs");
    await expect(main()).resolves.toBe(1);
  });
});
