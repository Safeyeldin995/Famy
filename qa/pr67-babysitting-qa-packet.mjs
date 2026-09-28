/**
 * Repository-only execution packet for PR #67 babysitting QA.
 * Import is side-effect free and never contacts remote systems.
 */
export const PR67_MIGRATIONS = Object.freeze([
  "20260912090000_babysitting_capabilities.sql",
  "20260928081021_babysitting_declaration_save.sql",
  "20260928093002_approved_request_updated_details.sql",
]);

export const PR67_FIXTURE_SUITE = "babysittingCapabilities.integration";

export const PR67_PENDING_TEARDOWN_FILE = "qa/report/pr67-babysitting-pending-teardown.json";
export const PR67_TEARDOWN_FINGERPRINT_ENV = "PR67_TEARDOWN_PLAN_FINGERPRINT";
export const PR67_TEARDOWN_RESUME_CLI = "qa/pr67-babysitting-teardown-resume.mjs";

export const PR67_REMOTE_EXECUTION_AUTHORIZED = false;

/** SQL editor / psql probes. Not PostgREST. */
export const PR67_SQL_CHECKS = Object.freeze([
  "select version() as pg_version",
  "select proname from pg_proc where proname in ('provider_save_onboarding_section','admin_provider_onboarding_action','create_booking','request_reschedule','respond_reschedule','provider_submit_onboarding','apply_provider_onboarding_status')",
  "select version from supabase_migrations.schema_migrations where version in ('20260912090000','20260928081021','20260928093002') order by version",
]);

/** PostgREST table probes after owner-approved QA access. Not information_schema privilege catalogs. */
export const PR67_POSTGREST_CHECKS = Object.freeze([
  "GET /rest/v1/child_age_groups?is_active=eq.true&select=code,min_months,max_months,sort_order&order=sort_order",
  "GET /rest/v1/providers?select=max_children_per_booking&limit=1",
  "GET /rest/v1/provider_age_group_capabilities?select=provider_id&limit=1",
]);

export const PR67_SCHEMA_CHECKS = Object.freeze([
  ...PR67_SQL_CHECKS.map((probe) => ({ via: "sql", probe })),
  ...PR67_POSTGREST_CHECKS.map((probe) => ({ via: "postgrest", probe })),
]);

export function credentialedTestCommand() {
  return [
    "npm",
    "run",
    "test:otp-integration",
    "--",
    "src/lib/provider/__tests__/babysittingCapabilities.integration.test.ts",
  ];
}

export function teardownResumeVerifyCommand() {
  return Object.freeze([
    "node",
    "qa/run-with-qa-env.mjs",
    "node",
    PR67_TEARDOWN_RESUME_CLI,
    `--pending-file=${PR67_PENDING_TEARDOWN_FILE}`,
  ]);
}

export function teardownResumeExecuteCommand() {
  return Object.freeze([
    "node",
    "qa/run-with-qa-env.mjs",
    "node",
    PR67_TEARDOWN_RESUME_CLI,
    "--execute",
    "--confirm=I-UNDERSTAND-QA-CONTAINMENT",
    `--pending-file=${PR67_PENDING_TEARDOWN_FILE}`,
    "--plan-fingerprint=<owner-approved-reviewed-hex>",
  ]);
}

export function requiredReadOnlyCommands() {
  return Object.freeze([
    ["npm", "run", "qa:preflight"],
    ["node", "qa/run-with-qa-env.mjs", "node", "qa/verify-residue.mjs"],
    ["node", "qa/run-with-qa-env.mjs", "node", "qa/containment.mjs"],
    ["node", "qa/run-with-qa-env.mjs", "node", "qa/cleanup.mjs"],
    teardownResumeVerifyCommand(),
  ]);
}

export function blockedUntilSeparateOwnerYes() {
  return Object.freeze([
    "QA apply of the three unpublished migrations",
    "credentialed npm run test:otp-integration against QA",
    "PR67 babysitting teardown resume execute (owner-approved fingerprint)",
    "standalone qa/containment.mjs --execute",
    "cleanup --execute",
    "baseline-repair --execute",
    "Production apply, merge, deploy, credential change",
  ]);
}

export const PR67_FIXTURE_SCOPE =
  "IntegrationFixtureRegistry snapshot only. Seeded babysitting category (never create shared categories). QA_ prefixed services/zones/users. Two-stage teardown: (1) mutating-suite afterAll is a dry-run only — persist pending snapshot+plan, zero teardown writes, residue stays active; (2) qa/pr67-babysitting-teardown-resume.mjs with PR67_TEARDOWN_PLAN_FINGERPRINT and that pending file, without reseeding or currentPlan injection. Verify rebuilds the live plan and writes nothing; execute requires --execute --confirm=I-UNDERSTAND-QA-CONTAINMENT plus the reviewed fingerprint. The pending file fingerprint is never auto-approved. Shared teardown executes the approved containment plan as-is (no silent replan) after executable-plan integrity, and writes only approved snapshot targets including link/row deletes. Standalone qa/containment.mjs --execute and qa/cleanup.mjs --execute remain blocked. No unrelated-user scans.";

export function printPacket() {
  const packet = {
    remoteExecutionAuthorized: PR67_REMOTE_EXECUTION_AUTHORIZED,
    migrationsInFilenameOrder: PR67_MIGRATIONS,
    fixtureSuite: PR67_FIXTURE_SUITE,
    fixtureScope: PR67_FIXTURE_SCOPE,
    schemaChecks: PR67_SCHEMA_CHECKS,
    requiredReadOnlyCommands: requiredReadOnlyCommands(),
    credentialedTestCommand: credentialedTestCommand(),
    teardownResumeVerifyCommand: teardownResumeVerifyCommand(),
    teardownResumeExecuteCommand: teardownResumeExecuteCommand(),
    fingerprintRules: [
      "Do not auto-approve a fingerprint generated in the same mutating execution. Format-only 64-char checks are not approval.",
      "Stage 1 dry-run persists qa/report/pr67-babysitting-pending-teardown.json (residueActive=true, writesPerformed=false, automaticContainmentIsReadOnly=false). Review that file. Do not rerun the mutating suite to resume cleanup.",
      "Stage 2a verify (zero writes): node qa/run-with-qa-env.mjs node qa/pr67-babysitting-teardown-resume.mjs --pending-file=qa/report/pr67-babysitting-pending-teardown.json. Rebuilds the current executable plan; fail-closed on drift. Does not treat the pending fingerprint as approval.",
      "Stage 2b execute: PR67_TEARDOWN_PLAN_FINGERPRINT=<reviewed-hex> node qa/run-with-qa-env.mjs node qa/pr67-babysitting-teardown-resume.mjs --execute --confirm=I-UNDERSTAND-QA-CONTAINMENT --pending-file=qa/report/pr67-babysitting-pending-teardown.json --plan-fingerprint=<reviewed-hex>. Fail-closed on absent/malformed/mismatched fingerprint, summary-vs-executable discrepancy, or a drifted snapshot/containment plan. Executes the reviewed executable plan, not a rebuilt one.",
      "Shared teardown with approval recomputes fingerprintContainmentPlan from deserialized executable actions before any write (including zone/service/provider link deletes). It does not discard approval and replan. Other suites that omit approval are unchanged.",
      "Standalone containment/cleanup --execute still require a separate reviewed dry-run, the exact current fingerprint, and owner yes. Never pass those --execute flags in this packet.",
      "Stop on FAMY_ENV / project-ref mismatch.",
    ],
    blockedUntilSeparateOwnerYes: blockedUntilSeparateOwnerYes(),
  };
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
  return packet;
}
