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

export function requiredReadOnlyCommands() {
  return Object.freeze([
    ["npm", "run", "qa:preflight"],
    ["node", "qa/run-with-qa-env.mjs", "node", "qa/verify-residue.mjs"],
    ["node", "qa/run-with-qa-env.mjs", "node", "qa/containment.mjs"],
    ["node", "qa/run-with-qa-env.mjs", "node", "qa/cleanup.mjs"],
  ]);
}

export function blockedUntilSeparateOwnerYes() {
  return Object.freeze([
    "QA apply of the three unpublished migrations",
    "credentialed npm run test:otp-integration against QA",
    "standalone qa/containment.mjs --execute",
    "cleanup --execute",
    "baseline-repair --execute",
    "Production apply, merge, deploy, credential change",
  ]);
}

export const PR67_FIXTURE_SCOPE =
  "IntegrationFixtureRegistry snapshot only. Seeded babysitting category (never create shared categories). QA_ prefixed services/zones/users. afterAll dry-runs snapshot containment and requires the current 64-char plan fingerprint, then teardownRegisteredFixture with bookingRpcClient (snapshot integrationMode execute). Standalone qa/containment.mjs --execute and qa/cleanup.mjs --execute remain blocked. No unrelated-user scans.";

export function printPacket() {
  const packet = {
    remoteExecutionAuthorized: PR67_REMOTE_EXECUTION_AUTHORIZED,
    migrationsInFilenameOrder: PR67_MIGRATIONS,
    fixtureSuite: PR67_FIXTURE_SUITE,
    fixtureScope: PR67_FIXTURE_SCOPE,
    schemaChecks: PR67_SCHEMA_CHECKS,
    requiredReadOnlyCommands: requiredReadOnlyCommands(),
    credentialedTestCommand: credentialedTestCommand(),
    fingerprintRules: [
      "This suite's afterAll dry-runs snapshot containment and requires the exact current 64-char plan fingerprint before shared teardown.",
      "Shared teardown then performs snapshot integrationMode execute with bookingRpcClient. That is not standalone qa/containment.mjs --execute.",
      "Standalone containment/cleanup --execute still require a separate reviewed dry-run, the exact current fingerprint, and owner yes. Never pass --execute in this packet. Rebuild dry-run if fingerprint drifts or project-ref mismatches.",
      "Stop on FAMY_ENV / project-ref mismatch.",
    ],
    blockedUntilSeparateOwnerYes: blockedUntilSeparateOwnerYes(),
  };
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
  return packet;
}
