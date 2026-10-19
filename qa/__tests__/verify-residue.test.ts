import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFakeQaEnvFileContent } from "./qa-env-test-harness.ts";

type ResidueRow = Record<string, unknown>;

type QueryResult = {
  data: ResidueRow[] | null;
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
};

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

const REPO_ROOT = process.cwd();
const CHECKOUT_REPORT = path.join(REPO_ROOT, "qa/report/residue-verify.json");

function snapshotCheckoutReport() {
  if (!fs.existsSync(CHECKOUT_REPORT)) {
    return { existed: false as const };
  }
  return {
    existed: true as const,
    content: fs.readFileSync(CHECKOUT_REPORT),
    mtimeMs: fs.statSync(CHECKOUT_REPORT).mtimeMs,
  };
}

function assertCheckoutReportUntouched(snapshot: ReturnType<typeof snapshotCheckoutReport>) {
  if (!snapshot.existed) {
    expect(fs.existsSync(CHECKOUT_REPORT)).toBe(false);
    return;
  }
  expect(fs.statSync(CHECKOUT_REPORT).mtimeMs).toBe(snapshot.mtimeMs);
  expect(fs.readFileSync(CHECKOUT_REPORT)).toEqual(snapshot.content);
}

describe("verify-residue fail-closed reads", () => {
  let envFile = "";
  let workDir = "";
  let runDir = "";
  let checkoutSnapshot: ReturnType<typeof snapshotCheckoutReport> = { existed: false };
  const previousCwd = process.cwd();

  beforeEach(async () => {
    checkoutSnapshot = snapshotCheckoutReport();
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-residue-fail-closed-"));
    runDir = path.join(workDir, "run");
    fs.mkdirSync(runDir);
    envFile = path.join(workDir, ".env.qa.local");
    fs.writeFileSync(envFile, buildFakeQaEnvFileContent(), "utf8");
    process.chdir(runDir);
    vi.resetModules();
    const { configureQaEnvFilePathForTests, loadQaEnv } = await import("../load-qa-env.mjs");
    configureQaEnvFilePathForTests(envFile);
    loadQaEnv({ required: true });
  });

  afterEach(async () => {
    process.chdir(previousCwd);
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
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      const code = await main();
      return { code, logs, errors };
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  }

  function isolatedReportPath() {
    return path.join(runDir, "qa/report/residue-verify.json");
  }

  it("fails closed when a read returns data: null with an error", async () => {
    const { code, logs, errors } = await runMain({
      ...EMPTY_TABLES,
      services: {
        data: null,
        error: { code: "PGRST301", message: "JWT expired" },
      },
    });

    expect(code).toBe(1);
    expect(logs.join("\n")).not.toMatch(/\[qa-residue] clean/);
    expect(errors.join("\n")).toBe("[qa-residue] read failed: active_qa_services code=PGRST301");
    expect(errors.join("\n")).not.toMatch(/message=/);
    expect(fs.existsSync(isolatedReportPath())).toBe(false);
    assertCheckoutReportUntouched(checkoutSnapshot);
  });

  it("logs only an allowlisted code and never phone, request body, or hostile code text", async () => {
    const phone = "+201012345678";
    const requestBody = JSON.stringify({
      password: "super-secret",
      phone,
      cookie: "session=abc",
    });
    const hostileCode = `${phone}; ${requestBody}; Set-Cookie: session=abc`;
    const { code, logs, errors } = await runMain({
      ...EMPTY_TABLES,
      bookings: {
        data: null,
        error: {
          code: hostileCode,
          message: `query failed ${phone} body=${requestBody}`,
          details: requestBody,
          hint: phone,
        },
      },
    });

    const output = `${logs.join("\n")}\n${errors.join("\n")}`;
    expect(code).toBe(1);
    expect(errors.join("\n")).toBe("[qa-residue] read failed: active_qa_bookings code=unknown");
    expect(output).not.toContain(phone);
    expect(output).not.toContain("201012345678");
    expect(output).not.toContain("super-secret");
    expect(output).not.toContain("Set-Cookie");
    expect(output).not.toContain(requestBody);
    expect(output).not.toMatch(/message=/);
    expect(output).not.toMatch(/details=/);
    expect(output).not.toMatch(/hint=/);
    expect(fs.existsSync(isolatedReportPath())).toBe(false);
    assertCheckoutReportUntouched(checkoutSnapshot);
  });

  it("treats successful empty reads as clean residue without touching the checkout report", async () => {
    const { code, logs } = await runMain(EMPTY_TABLES);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/\[qa-residue] clean\. retained profiles: 0/);
    const report = JSON.parse(fs.readFileSync(isolatedReportPath(), "utf8"));
    expect(report).toMatchObject({
      active_qa_zones: [],
      active_qa_services: [],
      active_qa_payment_methods: [],
      active_qa_campaigns: [],
      active_qa_bookings: [],
      retained_qa_profiles: [],
    });
    expect(path.resolve(isolatedReportPath()).startsWith(path.resolve(workDir))).toBe(true);
    assertCheckoutReportUntouched(checkoutSnapshot);
  });

  it("keeps successful retained suspended profiles as clean without touching the checkout report", async () => {
    const { code, logs } = await runMain({
      ...EMPTY_TABLES,
      profiles: {
        data: [{ id: "profile-1", full_name: "QA_retained", is_suspended: true }],
        error: null,
      },
    });
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/\[qa-residue] clean\. retained profiles: 1/);
    const report = JSON.parse(fs.readFileSync(isolatedReportPath(), "utf8"));
    expect(report.retained_qa_profiles).toEqual([
      {
        id: "profile-1",
        full_name: "QA_retained",
        is_suspended: true,
        reason:
          "Retained only when FK-bound or auth deletion failed; must remain suspended/neutralized",
      },
    ]);
    assertCheckoutReportUntouched(checkoutSnapshot);
  });
});
