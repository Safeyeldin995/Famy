import { describe, expect, it } from "vitest";
import {
  PR67_FIXTURE_SUITE,
  PR67_MIGRATIONS,
  PR67_PENDING_TEARDOWN_FILE,
  PR67_POSTGREST_CHECKS,
  PR67_REMOTE_EXECUTION_AUTHORIZED,
  PR67_SCHEMA_CHECKS,
  PR67_SQL_CHECKS,
  PR67_FIXTURE_SCOPE,
  PR67_TEARDOWN_FINGERPRINT_ENV,
  PR67_TEARDOWN_RESUME_CLI,
  blockedUntilSeparateOwnerYes,
  credentialedTestCommand,
  requiredReadOnlyCommands,
  teardownResumeExecuteCommand,
  teardownResumeVerifyCommand,
} from "../pr67-babysitting-qa-packet.mjs";

describe("PR67 babysitting QA execution packet", () => {
  it("orders the three unpublished migrations and forbids remote execution", () => {
    expect(PR67_MIGRATIONS).toEqual([
      "20260912090000_babysitting_capabilities.sql",
      "20260928081021_babysitting_declaration_save.sql",
      "20260928093002_approved_request_updated_details.sql",
    ]);
    expect(PR67_FIXTURE_SUITE).toBe("babysittingCapabilities.integration");
    expect(PR67_REMOTE_EXECUTION_AUTHORIZED).toBe(false);
    expect(PR67_SQL_CHECKS.join("\n")).toMatch(/schema_migrations where version in/);
    expect(PR67_SQL_CHECKS.join("\n")).not.toMatch(/where name in/);
    expect(PR67_POSTGREST_CHECKS.every((row) => row.startsWith("GET /rest/v1/"))).toBe(true);
    expect(PR67_SCHEMA_CHECKS.map((row) => row.via).sort()).toEqual([
      "postgrest",
      "postgrest",
      "postgrest",
      "sql",
      "sql",
      "sql",
    ]);
    expect(JSON.stringify(PR67_SCHEMA_CHECKS)).not.toMatch(/table_privileges|pg_policies/);
    const readonly = requiredReadOnlyCommands().map((row) => row.join(" "));
    expect(readonly.some((row) => row.includes("qa:preflight"))).toBe(true);
    expect(readonly.some((row) => row.includes("verify-residue.mjs"))).toBe(true);
    expect(readonly.every((row) => !row.includes("--execute"))).toBe(true);
    expect(credentialedTestCommand()).toEqual([
      "npm",
      "run",
      "test:otp-integration",
      "--",
      "src/lib/provider/__tests__/babysittingCapabilities.integration.test.ts",
    ]);
    expect(credentialedTestCommand().join(" ")).not.toContain("--execute");
    expect(blockedUntilSeparateOwnerYes().join(" ")).toMatch(/Production|merge|--execute/i);
    expect(PR67_FIXTURE_SCOPE).toMatch(/Two-stage teardown/);
    expect(PR67_FIXTURE_SCOPE).toMatch(/zero teardown writes/);
    expect(PR67_FIXTURE_SCOPE).toMatch(/PR67_TEARDOWN_PLAN_FINGERPRINT/);
    expect(PR67_FIXTURE_SCOPE).toMatch(/qa\/pr67-babysitting-teardown-resume\.mjs/);
    expect(PR67_FIXTURE_SCOPE).toMatch(/never auto-approved/);
    expect(PR67_FIXTURE_SCOPE).toMatch(/no silent replan/);
    expect(PR67_FIXTURE_SCOPE).toMatch(/Standalone qa\/containment\.mjs --execute/);
    expect(PR67_PENDING_TEARDOWN_FILE).toBe("qa/report/pr67-babysitting-pending-teardown.json");
    expect(PR67_TEARDOWN_FINGERPRINT_ENV).toBe("PR67_TEARDOWN_PLAN_FINGERPRINT");
    expect(PR67_TEARDOWN_RESUME_CLI).toBe("qa/pr67-babysitting-teardown-resume.mjs");
    expect(teardownResumeVerifyCommand().join(" ")).toContain(PR67_TEARDOWN_RESUME_CLI);
    expect(teardownResumeVerifyCommand().join(" ")).not.toContain("--execute");
    expect(teardownResumeExecuteCommand().join(" ")).toContain("--execute");
    expect(teardownResumeExecuteCommand().join(" ")).toContain("--plan-fingerprint=");
    expect(teardownResumeExecuteCommand().join(" ")).not.toMatch(/[0-9a-f]{64}/);
    expect(requiredReadOnlyCommands().some((row) => row.includes(PR67_TEARDOWN_RESUME_CLI))).toBe(
      true,
    );
    expect(PR67_FIXTURE_SCOPE).not.toMatch(/No cleanup execute\./);
    expect(PR67_FIXTURE_SCOPE).not.toMatch(
      /then teardownRegisteredFixture with bookingRpcClient \(snapshot integrationMode execute\)/,
    );
  });
});
