import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFakeQaEnvFileContent } from "./qa-env-test-harness.ts";

type ResidueRow = Record<string, unknown>;

type QueryResult = { data: ResidueRow[] | null; error: { code?: string; message?: string } | null };

function thenableQuery(result: QueryResult) {
  const chain = {
    eq: () => chain,
    or: () => chain,
    in: () => chain,
    ilike: () => chain,
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function mockAdmin(results: Record<string, QueryResult>) {
  return {
    from: (table: string) => ({
      select: () => thenableQuery(results[table] ?? { data: [], error: null }),
    }),
  };
}

const SUCCESS_EMPTY: QueryResult = { data: [], error: null };

const EMPTY_TABLES: Record<string, QueryResult> = {
  zones: SUCCESS_EMPTY,
  services: SUCCESS_EMPTY,
  payment_methods: SUCCESS_EMPTY,
  notification_campaigns: SUCCESS_EMPTY,
  bookings: SUCCESS_EMPTY,
  profiles: SUCCESS_EMPTY,
};

const originalWriteFileSync = fs.writeFileSync.bind(fs);

describe("verify-residue fail-closed reads", () => {
  let envFile = "";
  let workDir = "";
  const residueReportPath = path.resolve(process.cwd(), "qa/report/residue-verify.json");

  beforeEach(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-residue-fail-closed-"));
    envFile = path.join(workDir, ".env.qa.local");
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
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  async function runMain(results: Record<string, QueryResult>) {
    vi.resetModules();
    const { configureQaEnvFilePathForTests } = await import("../load-qa-env.mjs");
    configureQaEnvFilePathForTests(envFile);
    vi.doMock("../admin-client.mjs", () => ({
      getSupabaseAdmin: () => mockAdmin(results),
      supabaseAdmin: {},
    }));
    const { main } = await import("../verify-residue.mjs");
    const logs: string[] = [];
    const errors: string[] = [];
    const written: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
    });
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      written.push(String(file));
      return originalWriteFileSync(file, data, options);
    });
    try {
      const code = await main();
      return { code, logs, errors, written };
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      writeSpy.mockRestore();
    }
  }

  it("fails closed when a read returns data: null with an error", async () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb";
    const leakedId = "aaaaaaaa-1111-4111-8111-111111111111";
    const { code, logs, errors, written } = await runMain({
      ...EMPTY_TABLES,
      services: {
        data: null,
        error: {
          code: "PGRST301",
          message: `JWT ${jwt} user ${leakedId} qa-admin@famio.local sb_secret_test_placeholder`,
        },
      },
    });

    expect(code).toBe(1);
    expect(logs.join("\n")).not.toMatch(/\[qa-residue] clean/);
    expect(errors.join("\n")).toMatch(/\[qa-residue] read failed: active_qa_services/);
    expect(errors.join("\n")).toMatch(/code=PGRST301/);
    expect(errors.join("\n")).not.toContain(jwt);
    expect(errors.join("\n")).not.toContain(leakedId);
    expect(errors.join("\n")).not.toContain("qa-admin@famio.local");
    expect(errors.join("\n")).not.toContain("sb_secret_test_placeholder");
    expect(written.some((file) => file.endsWith("residue-verify.json"))).toBe(false);
  });

  it("treats successful empty reads as clean residue", async () => {
    const { code, logs, written } = await runMain(EMPTY_TABLES);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/\[qa-residue] clean\. retained profiles: 0/);
    expect(written).toContain(residueReportPath);
    const report = JSON.parse(fs.readFileSync(residueReportPath, "utf8"));
    expect(report).toMatchObject({
      active_qa_zones: [],
      active_qa_services: [],
      active_qa_payment_methods: [],
      active_qa_campaigns: [],
      active_qa_bookings: [],
      retained_qa_profiles: [],
    });
  });

  it("keeps successful retained suspended profiles as clean", async () => {
    const { code, logs } = await runMain({
      ...EMPTY_TABLES,
      profiles: {
        data: [{ id: "profile-1", full_name: "QA_retained", is_suspended: true }],
        error: null,
      },
    });
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/\[qa-residue] clean\. retained profiles: 1/);
    const report = JSON.parse(fs.readFileSync(residueReportPath, "utf8"));
    expect(report.retained_qa_profiles).toEqual([
      {
        id: "profile-1",
        full_name: "QA_retained",
        is_suspended: true,
        reason:
          "Retained only when FK-bound or auth deletion failed; must remain suspended/neutralized",
      },
    ]);
  });
});
