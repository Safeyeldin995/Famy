// One-off QA maintenance: remove stale inactive QA-tagged services and booking dependents.
// Defaults to dry-run. Execute requires explicit confirmation + dry-run fingerprint.
import fs from "node:fs";
import path from "node:path";
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks, assertQaWriteGuard } from "./env-guard.mjs";
import { parseStaleQaServicesArgs } from "./stale-qa-services-args.mjs";
import { assertStaleQaServicesPlanApproved } from "./stale-qa-services-fingerprint.mjs";
import { getSupabaseAdmin } from "./admin-client.mjs";
import { parseSupabaseProjectRef } from "./qa-identity.mjs";
import { runCliIfDirect } from "./cli-entrypoint.mjs";
import {
  buildStaleQaServicesPlanFromAdmin,
  executeStaleQaServicesPlan,
  sanitizeStaleQaServicesPlanForReport,
} from "./stale-qa-services-planner.mjs";

function guardBeforeStaleQaServicesRead() {
  loadQaEnv({ required: true });
  runPreflightChecks(process.env);
}

function guardBeforeStaleQaServicesWrite() {
  loadQaEnv({ required: true });
  assertQaWriteGuard(process.env);
}

/**
 * @param {ReturnType<typeof sanitizeStaleQaServicesPlanForReport>} report
 */
function writeStaleQaServicesPlanReport(report) {
  const reportDir = path.resolve(process.cwd(), "qa/report");
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, "stale-qa-services-plan.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

/**
 * @param {Awaited<ReturnType<typeof buildStaleQaServicesPlanFromAdmin>>} plan
 */
function printDryRunSummary(plan) {
  console.log("[qa-stale-services:dry-run] No data was modified.");
  console.log(`[qa-stale-services:dry-run] plan_version=${plan.version}`);
  console.log(`[qa-stale-services:dry-run] masked_project_ref=${plan.maskedProjectRef}`);
  console.log(
    `[qa-stale-services:dry-run] override_immutable_history=${plan.overrideImmutableHistory ? "true" : "false"}`,
  );
  console.log(`[qa-stale-services:dry-run] service_targets=${plan.counts.service_targets}`);
  console.log(`[qa-stale-services:dry-run] deletable_services=${plan.counts.deletable_services}`);
  console.log(`[qa-stale-services:dry-run] retained_services=${plan.counts.retained_services}`);
  console.log(`[qa-stale-services:dry-run] planned_deletions=${plan.counts.planned_deletions}`);
  console.log(`[qa-stale-services:dry-run] planned_tables=${plan.counts.planned_tables}`);

  if (plan.overrideImmutableHistory) {
    console.log("[qa-stale-services:dry-run] *** IMMUTABLE HISTORY OVERRIDE ACTIVE ***");
    console.log(
      `[qa-stale-services:dry-run] OVERRIDE_PERMANENT_DELETE_audit_logs=${plan.immutableOverrideCounts.audit_logs}`,
    );
    console.log(
      `[qa-stale-services:dry-run] OVERRIDE_PERMANENT_DELETE_booking_cancellations=${plan.immutableOverrideCounts.booking_cancellations}`,
    );
    console.log(
      `[qa-stale-services:dry-run] OVERRIDE_PERMANENT_DELETE_messages=${plan.immutableOverrideCounts.messages}`,
    );
    console.log(
      `[qa-stale-services:dry-run] OVERRIDE_PERMANENT_DELETE_conversations=${plan.immutableOverrideCounts.conversations}`,
    );
    console.log("[qa-stale-services:dry-run] *** END IMMUTABLE HISTORY OVERRIDE COUNTS ***");
  }

  console.log(`[qa-stale-services:dry-run] plan_fingerprint=${plan.fingerprint}`);

  for (const row of plan.deletionSummary) {
    console.log(`[qa-stale-services:dry-run] delete_table=${row.table}:rows=${row.keyCount}`);
  }

  for (const service of plan.services) {
    console.log(
      `[qa-stale-services:dry-run] service=${service.name_en}:${service.maskedId}:bookings=${service.bookingCount}:deletable_bookings=${service.deletableBookingCount}:retained_bookings=${service.retainedBookingCount}:deletable=${service.deletable ? "true" : "false"}${service.retainReason ? `:retain_reason=${service.retainReason}` : ""}`,
    );
  }

  for (const row of plan.retained) {
    console.log(
      `[qa-stale-services:dry-run] retained=${row.table}:${row.id.slice(0, 4)}…${row.id.slice(-4)}:reason=${row.reason}`,
    );
  }

  if (plan.overrideImmutableHistory) {
    console.log(
      "[qa-stale-services:dry-run] Execute requires: --execute --confirm=I-UNDERSTAND-QA-STALE-SERVICE-CLEANUP --override-immutable-history --override-confirm=I-UNDERSTAND-THIS-PERMANENTLY-DELETES-QA-AUDIT-HISTORY --plan-fingerprint=<fingerprint>",
    );
  } else {
    console.log(
      "[qa-stale-services:dry-run] Execute requires: --execute --confirm=I-UNDERSTAND-QA-STALE-SERVICE-CLEANUP --plan-fingerprint=<fingerprint>",
    );
  }
}

/**
 * @param {{ plan: Awaited<ReturnType<typeof buildStaleQaServicesPlanFromAdmin>>; execution: Awaited<ReturnType<typeof executeStaleQaServicesPlan>>; success: boolean }} payload
 */
function printExecuteSummary(payload) {
  const { plan, execution, success } = payload;
  console.log(`[qa-stale-services:execute] plan_version=${plan.version}`);
  console.log(`[qa-stale-services:execute] plan_fingerprint=${plan.fingerprint}`);
  console.log(
    `[qa-stale-services:execute] override_immutable_history=${plan.overrideImmutableHistory ? "true" : "false"}`,
  );
  console.log(`[qa-stale-services:execute] success=${success ? "true" : "false"}`);
  console.log(
    `[qa-stale-services:execute] planned_deletions=${plan.counts.planned_deletions}:deletable_services=${plan.counts.deletable_services}`,
  );
  if (execution.errors.length) {
    console.log(
      `[qa-stale-services:execute] errors=${execution.errors.map((entry) => `${entry.table}:${entry.id}`).join(", ")}`,
    );
  }
}

/**
 * @param {{ overrideImmutableHistory?: boolean }} [options]
 */
export async function runStaleQaServicesDryRun(options = {}) {
  guardBeforeStaleQaServicesRead();
  const admin = getSupabaseAdmin();
  const projectRef = parseSupabaseProjectRef(process.env.QA_SUPABASE_URL);
  const plan = await buildStaleQaServicesPlanFromAdmin(admin, projectRef, options);
  const report = sanitizeStaleQaServicesPlanForReport(plan);
  writeStaleQaServicesPlanReport(report);
  printDryRunSummary(plan);
  return plan;
}

/**
 * @param {{ planFingerprint?: string; overrideImmutableHistory?: boolean }} [options]
 */
export async function runStaleQaServicesExecute(options = {}) {
  guardBeforeStaleQaServicesWrite();
  const admin = getSupabaseAdmin();
  const projectRef = parseSupabaseProjectRef(process.env.QA_SUPABASE_URL);
  const freshPlan = await buildStaleQaServicesPlanFromAdmin(admin, projectRef, options);
  assertStaleQaServicesPlanApproved(freshPlan, options.planFingerprint);
  const execution = await executeStaleQaServicesPlan(admin, freshPlan);
  const payload = { plan: freshPlan, execution, success: execution.success };
  printExecuteSummary(payload);
  return payload;
}

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  const parsed = parseStaleQaServicesArgs(argv);

  try {
    if (parsed.mode === "rejected") {
      console.error(`[qa-stale-services] ${parsed.error}`);
      return 1;
    }

    const planOptions = {
      overrideImmutableHistory: parsed.overrideImmutableHistory ?? false,
    };

    if (parsed.mode === "dry-run") {
      await runStaleQaServicesDryRun(planOptions);
      return 0;
    }

    const payload = await runStaleQaServicesExecute({
      planFingerprint: parsed.planFingerprint,
      ...planOptions,
    });
    return payload.success ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

runCliIfDirect(import.meta.url, () => main());

export {
  guardBeforeStaleQaServicesRead,
  guardBeforeStaleQaServicesWrite,
  printDryRunSummary,
  printExecuteSummary,
  writeStaleQaServicesPlanReport,
};
