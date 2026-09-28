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

/** Read-only probes via PostgREST after owner-approved QA access. Not information_schema privilege catalogs. */
export const PR67_SCHEMA_CHECKS = Object.freeze([
  "select version() as pg_version",
  "select code, min_months, max_months, sort_order from child_age_groups where is_active = true order by sort_order",
  "select max_children_per_booking from providers limit 1",
  "select provider_id from provider_age_group_capabilities limit 1",
  "select proname from pg_proc where proname in ('provider_save_onboarding_section','admin_provider_onboarding_action','create_booking','request_reschedule','respond_reschedule','provider_submit_onboarding','apply_provider_onboarding_status')",
  "select version, name from supabase_migrations.schema_migrations where name in ('20260912090000','20260928081021','20260928093002') order by version",
]);

export function credentialedTestCommand() {
  return [
    "node",
    "qa/run-with-qa-env.mjs",
    "vitest",
    "run",
    "--config",
    "vitest.otp-integration.config.ts",
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
    "credentialed vitest run against QA",
    "containment --execute",
    "cleanup --execute",
    "baseline-repair --execute",
    "Production apply, merge, deploy, credential change",
  ]);
}

export function printPacket() {
  const packet = {
    remoteExecutionAuthorized: PR67_REMOTE_EXECUTION_AUTHORIZED,
    migrationsInFilenameOrder: PR67_MIGRATIONS,
    fixtureSuite: PR67_FIXTURE_SUITE,
    fixtureScope:
      "IntegrationFixtureRegistry snapshot only. Seeded babysitting category (never create shared categories). QA_ prefixed services/zones/users. afterAll teardownRegisteredFixture. No unrelated-user scans. No cleanup execute.",
    schemaChecks: PR67_SCHEMA_CHECKS,
    requiredReadOnlyCommands: requiredReadOnlyCommands(),
    credentialedTestCommand: credentialedTestCommand(),
    fingerprintRules: [
      "Containment/cleanup execute require reviewed dry-run plus the exact current 64-char plan fingerprint.",
      "Never pass --execute in this packet. Rebuild dry-run if fingerprint drifts or project-ref mismatches.",
      "Stop on FAMY_ENV / project-ref mismatch.",
    ],
    blockedUntilSeparateOwnerYes: blockedUntilSeparateOwnerYes(),
  };
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
  return packet;
}
