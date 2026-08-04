import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {"pure-library" | "safe-readonly-cli" | "remote-read-cli" | "destructive-cli" | "wrapper-cli"} EntrypointClass */

/** @type {Record<string, EntrypointClass>} */
export const QA_ENTRYPOINT_CLASSIFICATION = {
  "admin-client.mjs": "pure-library",
  "authenticated-client.mjs": "pure-library",
  "cleanup-args.mjs": "pure-library",
  "cleanup.mjs": "destructive-cli",
  "cli-entrypoint.mjs": "pure-library",
  "containment-args.mjs": "pure-library",
  "containment-booking-caller.mjs": "pure-library",
  "containment-booking-lifecycle.mjs": "pure-library",
  "containment-core.mjs": "pure-library",
  "containment-fingerprint.mjs": "pure-library",
  "containment-identity.mjs": "pure-library",
  "containment-integration.mjs": "pure-library",
  "containment-planner.mjs": "pure-library",
  "containment.mjs": "destructive-cli",
  "env-guard.mjs": "pure-library",
  "env.mjs": "pure-library",
  "entrypoint-audit.mjs": "pure-library",
  "list-users-paginated.mjs": "pure-library",
  "load-qa-env.mjs": "pure-library",
  "orphan-recovery.mjs": "pure-library",
  "playwright-webserver-env.mjs": "pure-library",
  "preflight.mjs": "safe-readonly-cli",
  "qa-classification.mjs": "pure-library",
  "qa-identity.mjs": "pure-library",
  "read-e2e-otp.mjs": "pure-library",
  "registry.mjs": "pure-library",
  "restoration-registry.mjs": "pure-library",
  "run-with-qa-env.mjs": "wrapper-cli",
  "runtime-identity-build.mjs": "pure-library",
  "runtime-identity-fetch.mjs": "pure-library",
  "teardown-audit-design.mjs": "pure-library",
  "teardown-core.mjs": "pure-library",
  "teardown-errors.mjs": "pure-library",
  "teardown-fk-contract.mjs": "pure-library",
  "teardown-fk-plan.mjs": "pure-library",
  "teardown-operations.mjs": "pure-library",
  "teardown-outcomes.mjs": "pure-library",
  "teardown-plan-normalize.mjs": "pure-library",
  "teardown-planner.mjs": "pure-library",
  "teardown-recovery-classify.mjs": "pure-library",
  "teardown-retained-services.mjs": "pure-library",
  "teardown-row-locators.mjs": "pure-library",
  "teardown-terminal-disable.mjs": "pure-library",
  "teardown-user-lifecycle.mjs": "pure-library",
  "teardown-verification.mjs": "pure-library",
  "verify-onboarding-privileges.mjs": "remote-read-cli",
  "verify-residue.mjs": "remote-read-cli",
  "vitest-otp-global-setup.mjs": "pure-library",
};

/** CLI modules that must not execute on import. */
export const QA_CLI_GUARD_REQUIRED = [
  "cleanup.mjs",
  "containment.mjs",
  "preflight.mjs",
  "verify-residue.mjs",
  "run-with-qa-env.mjs",
  "verify-onboarding-privileges.mjs",
];

/**
 * @param {string} [qaRoot]
 */
export function auditQaEntrypoints(qaRoot) {
  const root = qaRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  const files = fs.readdirSync(root)
    .filter((name) => name.endsWith(".mjs") && !name.startsWith("."))
    .sort();

  /** @type {Array<{ file: string; classification: EntrypointClass; guardRequired: boolean; hasGuard: boolean; hasExportedMain: boolean }>} */
  const rows = [];

  for (const file of files) {
    const classification = QA_ENTRYPOINT_CLASSIFICATION[file] ?? "pure-library";
    const guardRequired = QA_CLI_GUARD_REQUIRED.includes(file);
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const hasGuard = source.includes("runCliIfDirect(import.meta.url")
      || source.includes("isDirectExecution(import.meta.url");
    const hasExportedMain = /export (async )?function main/.test(source);
    rows.push({ file, classification, guardRequired, hasGuard, hasExportedMain });
  }

  return rows;
}

/**
 * @param {string} [qaRoot]
 */
export function assertQaCliGuards(qaRoot) {
  const violations = auditQaEntrypoints(qaRoot).filter((row) =>
    row.guardRequired && (!row.hasGuard || !row.hasExportedMain),
  );
  if (violations.length) {
    throw new Error(
      `[qa-entrypoint-audit] missing CLI guard or exported main: ${violations.map((v) => v.file).join(", ")}`,
    );
  }
}
