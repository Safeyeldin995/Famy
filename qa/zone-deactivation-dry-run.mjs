// Standalone QA zone deactivation — defaults to dry-run; zone-only mutations.
import fs from "node:fs";
import path from "node:path";
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks, assertQaWriteGuard } from "./env-guard.mjs";
import { parseZoneDeactivationArgs } from "./zone-deactivation-args.mjs";
import { assertZoneDeactivationPlanApproved } from "./zone-deactivation-fingerprint.mjs";
import { getSupabaseAdmin } from "./admin-client.mjs";
import { parseSupabaseProjectRef } from "./qa-identity.mjs";
import { runCliIfDirect } from "./cli-entrypoint.mjs";
import {
  buildZoneDeactivationPlanFromAdmin,
  executeZoneDeactivationPlan,
  sanitizeZoneDeactivationPlanForReport,
} from "./zone-deactivation-planner.mjs";

function guardBeforeZoneDeactivationRead() {
  loadQaEnv({ required: true });
  runPreflightChecks(process.env);
}

function guardBeforeZoneDeactivationWrite() {
  loadQaEnv({ required: true });
  assertQaWriteGuard(process.env);
}

/**
 * @param {ReturnType<typeof sanitizeZoneDeactivationPlanForReport>} report
 */
function writeZoneDeactivationPlanReport(report) {
  const reportDir = path.resolve(process.cwd(), "qa/report");
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, "zone-deactivation-plan.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

/**
 * @param {Awaited<ReturnType<typeof buildZoneDeactivationPlanFromAdmin>>} plan
 */
function printDryRunSummary(plan) {
  console.log("[qa-zone-deactivation:dry-run] No data was modified.");
  console.log(`[qa-zone-deactivation:dry-run] plan_version=${plan.version}`);
  console.log(`[qa-zone-deactivation:dry-run] masked_project_ref=${plan.maskedProjectRef}`);
  if (plan.blocked) {
    console.log(`[qa-zone-deactivation:dry-run] blocked=true`);
    console.log(`[qa-zone-deactivation:dry-run] blocked_reason=${plan.blockedReason ?? "true"}`);
    return;
  }
  console.log("[qa-zone-deactivation:dry-run] blocked=false");
  console.log(`[qa-zone-deactivation:dry-run] zone_targets=${plan.counts.zone_targets}`);
  console.log(`[qa-zone-deactivation:dry-run] planned_mutations=${plan.counts.planned_mutations}`);
  console.log(`[qa-zone-deactivation:dry-run] plan_fingerprint=${plan.fingerprint}`);
  for (const zone of plan.zones) {
    console.log(
      `[qa-zone-deactivation:dry-run] zone=${zone.name_en}:${zone.maskedId}:action=${zone.actionType}:zone_services=${zone.childCounts.zone_services}:zone_providers=${zone.childCounts.zone_providers}:spatial_addresses=${zone.observedSpatialAddressCount}`,
    );
  }
  console.log(
    "[qa-zone-deactivation:dry-run] Execute requires: --execute --confirm=I-UNDERSTAND-QA-ZONE-DEACTIVATION --plan-fingerprint=<fingerprint>",
  );
}

/**
 * @param {{ plan: Awaited<ReturnType<typeof buildZoneDeactivationPlanFromAdmin>>; execution: Awaited<ReturnType<typeof executeZoneDeactivationPlan>>; success: boolean }} payload
 */
function printExecuteSummary(payload) {
  const { plan, execution, success } = payload;
  console.log(`[qa-zone-deactivation:execute] plan_version=${plan.version}`);
  console.log(`[qa-zone-deactivation:execute] plan_fingerprint=${plan.fingerprint}`);
  console.log(`[qa-zone-deactivation:execute] success=${success ? "true" : "false"}`);
  console.log(
    `[qa-zone-deactivation:execute] masked_results=${execution.results.map((row) => `${row.entityType}:${row.maskedId}:${row.actionType}:${row.ok ? "ok" : "fail"}`).join(", ") || "(none)"}`,
  );
}

export async function runZoneDeactivationDryRun() {
  guardBeforeZoneDeactivationRead();
  const admin = getSupabaseAdmin();
  const projectRef = parseSupabaseProjectRef(process.env.QA_SUPABASE_URL);
  const plan = await buildZoneDeactivationPlanFromAdmin(admin, projectRef);
  const report = sanitizeZoneDeactivationPlanForReport(plan);
  writeZoneDeactivationPlanReport(report);
  printDryRunSummary(plan);
  return plan;
}

/**
 * @param {{ planFingerprint?: string }} [options]
 */
export async function runZoneDeactivationExecute(options = {}) {
  guardBeforeZoneDeactivationWrite();
  const admin = getSupabaseAdmin();
  const projectRef = parseSupabaseProjectRef(process.env.QA_SUPABASE_URL);
  const freshPlan = await buildZoneDeactivationPlanFromAdmin(admin, projectRef);
  assertZoneDeactivationPlanApproved(freshPlan, options.planFingerprint);
  const execution = await executeZoneDeactivationPlan(admin, freshPlan);
  const payload = { plan: freshPlan, execution, success: execution.success };
  printExecuteSummary(payload);
  return payload;
}

/**
 * @param {{ blocked: boolean }} plan
 * @returns {number}
 */
export function dryRunExitCode(plan) {
  return plan.blocked ? 2 : 0;
}

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  const parsed = parseZoneDeactivationArgs(argv);

  try {
    if (parsed.mode === "rejected") {
      console.error(`[qa-zone-deactivation] ${parsed.error}`);
      return 1;
    }

    if (parsed.mode === "dry-run") {
      const plan = await runZoneDeactivationDryRun();
      return dryRunExitCode(plan);
    }

    const payload = await runZoneDeactivationExecute({ planFingerprint: parsed.planFingerprint });
    return payload.success ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

runCliIfDirect(import.meta.url, () => main());

export {
  guardBeforeZoneDeactivationRead,
  guardBeforeZoneDeactivationWrite,
  printDryRunSummary,
  printExecuteSummary,
  writeZoneDeactivationPlanReport,
};
