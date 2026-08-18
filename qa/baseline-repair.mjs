// Standalone QA baseline repair — defaults to dry-run.
import fs from "node:fs";
import path from "node:path";
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks, assertQaWriteGuard } from "./env-guard.mjs";
import { parseBaselineRepairArgs } from "./baseline-repair-args.mjs";
import { getSupabaseAdmin } from "./admin-client.mjs";
import { parseSupabaseProjectRef } from "./qa-identity.mjs";
import { runCliIfDirect } from "./cli-entrypoint.mjs";
import {
  assertBaselineRepairPlanApproved,
  baselineRepairManifestPath,
  buildBaselineRepairPlanFromAdmin,
  executeBaselineRepairPlan,
  loadBaselineRepairManifest,
  sanitizeBaselineRepairPlanForReport,
  verifyProtectedCatalogCounts,
} from "./baseline-repair-planner.mjs";

function guardBeforeBaselineRepairRead() {
  loadQaEnv({ required: true });
  runPreflightChecks(process.env);
}

function guardBeforeBaselineRepairWrite() {
  loadQaEnv({ required: true });
  assertQaWriteGuard(process.env);
}

/**
 * @param {ReturnType<typeof sanitizeBaselineRepairPlanForReport>} report
 */
function writeBaselineRepairPlanReport(report) {
  const reportDir = path.resolve(process.cwd(), "qa/report");
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, "baseline-repair-plan.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

/**
 * @param {Awaited<ReturnType<typeof buildBaselineRepairPlanFromAdmin>> & { protectedCatalog?: Awaited<ReturnType<typeof verifyProtectedCatalogCounts>> }} plan
 */
function printDryRunSummary(plan) {
  console.log("[qa-baseline-repair:dry-run] No data was modified.");
  console.log(`[qa-baseline-repair:dry-run] plan_version=${plan.version}`);
  console.log(`[qa-baseline-repair:dry-run] masked_project_ref=${plan.maskedProjectRef}`);
  if (plan.blocked) {
    console.log(`[qa-baseline-repair:dry-run] blocked=${plan.blockedReason ?? "true"}`);
    return;
  }
  console.log("[qa-baseline-repair:dry-run] blocked=false");
  console.log(`[qa-baseline-repair:dry-run] setting_targets=${plan.counts.setting_targets}`);
  console.log(`[qa-baseline-repair:dry-run] zone_targets=${plan.counts.zone_targets}`);
  console.log(`[qa-baseline-repair:dry-run] planned_mutations=${plan.counts.planned_mutations}`);
  console.log(`[qa-baseline-repair:dry-run] plan_fingerprint=${plan.fingerprint}`);
  console.log(
    `[qa-baseline-repair:dry-run] setting_actions=${plan.settings.map((row) => `${row.key}:${row.actionType}`).join(", ") || "(none)"}`,
  );
  console.log(
    `[qa-baseline-repair:dry-run] zone_actions=${plan.zones.map((row) => `${row.name}:${row.maskedId}:${row.actionType}`).join(", ") || "(none)"}`,
  );
  if (plan.protectedCatalog) {
    console.log(
      `[qa-baseline-repair:dry-run] protected_categories=${plan.protectedCatalog.categoryCount}`,
    );
    console.log(
      `[qa-baseline-repair:dry-run] protected_seeded_services=${plan.protectedCatalog.seededServiceCount}`,
    );
    console.log(
      `[qa-baseline-repair:dry-run] protected_storage_buckets=${plan.protectedCatalog.storageBucketCount}`,
    );
  }
  console.log(
    "[qa-baseline-repair:dry-run] Execute requires: --execute --confirm=I-UNDERSTAND-QA-BASELINE-REPAIR --plan-fingerprint=<fingerprint>",
  );
}

/**
 * @param {{ plan: Awaited<ReturnType<typeof buildBaselineRepairPlanFromAdmin>>; execution: Awaited<ReturnType<typeof executeBaselineRepairPlan>>; success: boolean }} payload
 */
function printExecuteSummary(payload) {
  const { plan, execution, success } = payload;
  console.log(`[qa-baseline-repair:execute] plan_version=${plan.version}`);
  console.log(`[qa-baseline-repair:execute] plan_fingerprint=${plan.fingerprint}`);
  console.log(`[qa-baseline-repair:execute] success=${success ? "true" : "false"}`);
  console.log(
    `[qa-baseline-repair:execute] mutations_started=${execution.mutationsStarted ? "true" : "false"}`,
  );
  console.log(
    `[qa-baseline-repair:execute] masked_results=${execution.results.map((row) => `${row.entityType}:${row.maskedId}:${row.actionType}:${row.ok ? "ok" : "fail"}`).join(", ") || "(none)"}`,
  );
  if (execution.verification?.protectedCatalog) {
    const counts = execution.verification.protectedCatalog;
    console.log(`[qa-baseline-repair:execute] protected_categories=${counts.categoryCount}`);
    console.log(
      `[qa-baseline-repair:execute] protected_seeded_services=${counts.seededServiceCount}`,
    );
    console.log(
      `[qa-baseline-repair:execute] protected_storage_buckets=${counts.storageBucketCount}`,
    );
  }
  if (execution.verification?.reason) {
    console.log(
      `[qa-baseline-repair:execute] verification_reason=${execution.verification.reason}`,
    );
  }
}

/**
 * @returns {Promise<{ plan: Awaited<ReturnType<typeof buildBaselineRepairPlanFromAdmin>>; manifestPath: string }>}
 */
async function loadPlanFromLiveQa() {
  guardBeforeBaselineRepairRead();
  const manifestPath = baselineRepairManifestPath();
  const loaded = loadBaselineRepairManifest(manifestPath);
  if (!loaded.ok) {
    throw new Error(`[qa-baseline-repair] ${loaded.reason}`);
  }

  const projectRef = parseSupabaseProjectRef(process.env.QA_SUPABASE_URL);
  const admin = getSupabaseAdmin();
  const plan = await buildBaselineRepairPlanFromAdmin(admin, projectRef, loaded.manifest);
  const protectedCatalog = await verifyProtectedCatalogCounts(admin);
  const catalogBlocked = !protectedCatalog.ok;
  return {
    plan: {
      ...plan,
      blocked: plan.blocked || catalogBlocked,
      blockedReason: plan.blockedReason ?? (catalogBlocked ? "protected-catalog-drift" : null),
      fingerprint: catalogBlocked ? null : plan.fingerprint,
      protectedCatalog,
    },
    manifestPath,
  };
}

/**
 * @returns {Promise<Awaited<ReturnType<typeof buildBaselineRepairPlanFromAdmin>>>}
 */
export async function runBaselineRepairDryRun() {
  const { plan } = await loadPlanFromLiveQa();
  const report = sanitizeBaselineRepairPlanForReport(plan);
  if (plan.protectedCatalog) {
    report.protectedCatalog = {
      categoryCount: plan.protectedCatalog.categoryCount,
      seededServiceCount: plan.protectedCatalog.seededServiceCount,
      storageBucketCount: plan.protectedCatalog.storageBucketCount,
    };
  }
  writeBaselineRepairPlanReport(report);
  printDryRunSummary(plan);
  return plan;
}

/**
 * @param {{ planFingerprint?: string }} [options]
 */
export async function runBaselineRepairExecute(options = {}) {
  guardBeforeBaselineRepairWrite();
  const admin = getSupabaseAdmin();
  const manifestPath = baselineRepairManifestPath();
  const loaded = loadBaselineRepairManifest(manifestPath);
  if (!loaded.ok) {
    throw new Error(`[qa-baseline-repair] ${loaded.reason}`);
  }
  const projectRef = parseSupabaseProjectRef(process.env.QA_SUPABASE_URL);
  const freshPlan = await buildBaselineRepairPlanFromAdmin(admin, projectRef, loaded.manifest);
  const protectedCatalog = await verifyProtectedCatalogCounts(admin);
  const guardedPlan = {
    ...freshPlan,
    blocked: freshPlan.blocked || !protectedCatalog.ok,
    blockedReason:
      freshPlan.blockedReason ?? (!protectedCatalog.ok ? "protected-catalog-drift" : null),
    fingerprint: protectedCatalog.ok ? freshPlan.fingerprint : null,
    protectedCatalog,
  };
  assertBaselineRepairPlanApproved(guardedPlan, options.planFingerprint);
  const execution = await executeBaselineRepairPlan(admin, guardedPlan);
  const payload = { plan: guardedPlan, execution, success: execution.success };
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
  const parsed = parseBaselineRepairArgs(argv);

  try {
    if (parsed.mode === "rejected") {
      console.error(`[qa-baseline-repair] ${parsed.error}`);
      return 1;
    }

    if (parsed.mode === "dry-run") {
      const plan = await runBaselineRepairDryRun();
      return dryRunExitCode(plan);
    }

    const payload = await runBaselineRepairExecute({ planFingerprint: parsed.planFingerprint });
    return payload.success ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

runCliIfDirect(import.meta.url, () => main());

export {
  guardBeforeBaselineRepairRead,
  guardBeforeBaselineRepairWrite,
  printDryRunSummary,
  printExecuteSummary,
  writeBaselineRepairPlanReport,
};
