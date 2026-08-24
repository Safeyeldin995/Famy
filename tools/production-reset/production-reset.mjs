#!/usr/bin/env node
/** Production user-data reset — dry-run by default. Refuses non-Production refs for planning reads. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProductionResetArgs } from "./args.mjs";
import { loadProductionEnv } from "./load-production-env.mjs";
import { loadQaCloneEnv } from "./load-qa-clone-env.mjs";
import {
  buildProductionResetPlan,
  dryRunExitCode,
  sanitizePlanForReport,
} from "./plan.mjs";
import {
  runProductionResetExecute,
  printExecuteSimulateSummary,
} from "./execute.mjs";
import {
  RESET_CONFIRM_VALUE,
  EXECUTE_TARGET_QA_CLONE,
} from "./constants.mjs";

/**
 * @param {Awaited<ReturnType<typeof buildProductionResetPlan>>} plan
 */
function writePlanReport(plan) {
  const reportDir = path.resolve(process.cwd(), "tools/production-reset/report");
  fs.mkdirSync(reportDir, { recursive: true });
  const finalPath = path.join(reportDir, "production-reset-plan.json");
  const tempPath = path.join(reportDir, `.production-reset-plan.${process.pid}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify(sanitizePlanForReport(plan), null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, finalPath);
}

/**
 * @param {Awaited<ReturnType<typeof buildProductionResetPlan>>} plan
 * @param {{ target?: string }} [options]
 */
function printDryRunSummary(plan, options = {}) {
  console.log("[production-reset:dry-run] No data was modified.");
  console.log(`[production-reset:dry-run] plan_version=${plan.version}`);
  console.log(`[production-reset:dry-run] masked_project_ref=${plan.maskedProjectRef}`);
  if (options.target) {
    console.log(`[production-reset:dry-run] target=${options.target}`);
  }
  console.log(`[production-reset:dry-run] fk_graph_source=${plan.fkGraphSource}`);
  console.log(`[production-reset:dry-run] linked_ref_verified=${plan.linkedRefVerified}`);

  if (plan.blocked) {
    console.log("[production-reset:dry-run] blocked=true");
    console.log(`[production-reset:dry-run] blocked_reason=${plan.blockedReason}`);
    if (plan.blockedReasons?.length) {
      console.log(
        `[production-reset:dry-run] blocked_reasons=${plan.blockedReasons.join(";")}`,
      );
    }
    return;
  }
  console.log("[production-reset:dry-run] blocked=false");

  console.log(`[production-reset:dry-run] phase_a_truncate_roots=${plan.phaseA.truncateRoots.length}`);
  console.log(
    `[production-reset:dry-run] phase_a_truncate_cascade_closure_count=${plan.phaseA.truncateCascadeClosureCount}`,
  );
  console.log(
    `[production-reset:dry-run] phase_a_truncate_cascade_closure=${plan.phaseA.truncateCascadeClosure.join(",")}`,
  );

  console.log(`[production-reset:dry-run] phase_b_service_delete_count=${plan.phaseB.serviceDeleteCount}`);
  console.log(`[production-reset:dry-run] phase_b_service_keep_count=${plan.phaseB.serviceKeepCount}`);
  console.log(
    `[production-reset:dry-run] phase_b_service_delete_fingerprint=${plan.phaseB.serviceDeleteFingerprint}`,
  );
  console.log(
    `[production-reset:dry-run] phase_b_service_keep_fingerprint=${plan.phaseB.serviceKeepFingerprint}`,
  );
  console.log(`[production-reset:dry-run] phase_b_zone_delete_count=${plan.phaseB.zoneDeleteCount}`);
  console.log(`[production-reset:dry-run] phase_b_zone_delete_fingerprint=${plan.phaseB.zoneDeleteFingerprint}`);
  console.log(
    `[production-reset:dry-run] phase_b_service_requirements_delete=${plan.phaseB.serviceRequirementDeleteCount}`,
  );
  console.log(
    `[production-reset:dry-run] phase_b_service_requirements_delete_fingerprint=${plan.phaseB.serviceRequirementDeleteFingerprint}`,
  );
  console.log(
    `[production-reset:dry-run] phase_b_service_delete_cascade_tables=${plan.phaseB.serviceDeleteCascadeTables.join(",")}`,
  );

  console.log(`[production-reset:dry-run] scoped_public_row_removals=${plan.counts.scopedPublicRowRemovals}`);
  console.log(`[production-reset:dry-run] user_generated_public_rows=${plan.counts.userGeneratedPublicRows}`);
  console.log(`[production-reset:dry-run] audit_logs=${plan.counts.auditLogs}`);
  console.log(`[production-reset:dry-run] audit_logs_pct=${plan.counts.auditLogsPctOfUserRows}`);
  console.log(`[production-reset:dry-run] booking_locations=${plan.counts.bookingLocations}`);
  console.log(`[production-reset:dry-run] auth_users=${plan.counts.authUsers}`);
  console.log(`[production-reset:dry-run] storage_objects=${plan.counts.storageObjects}`);
  console.log(`[production-reset:dry-run] storage_preserve=${plan.phaseE.storagePreserveCount}`);
  console.log(
    `[production-reset:dry-run] storage_classification=${JSON.stringify(plan.storage.classification)}`,
  );
  console.log(
    `[production-reset:dry-run] avatar_auth_only_no_profile_count=${plan.storage.avatarAuthOnlyNoProfile.length}`,
  );
  console.log(
    `[production-reset:dry-run] avatar_auth_only_all_have_auth_user=${plan.storage.avatarAuthOnlyNoProfile.every((r) => r.hasAuthUser)}`,
  );

  console.log("[production-reset:dry-run] execute_order:");
  for (const step of plan.executeOrder) {
    console.log(`[production-reset:dry-run]   ${step}`);
  }

  console.log(
    `[production-reset:dry-run] audit_no_trigger_on=${plan.auditTriggerVerification.noAuditOn.join(",")}`,
  );

  console.log(
    `[production-reset:dry-run] phase_a_table_row_count_bindings=${Object.keys(plan.counts.tableCounts).length}`,
  );

  console.log("[production-reset:dry-run] table_row_counts:");
  for (const [table, count] of Object.entries(plan.counts.tableCounts).sort((a, b) => b[1] - a[1])) {
    if (count > 0) {
      console.log(`[production-reset:dry-run]   ${table}=${count}`);
    }
  }

  console.log(`[production-reset:dry-run] plan_fingerprint=${plan.fingerprint}`);
  console.log(`[production-reset:dry-run] plan_fingerprint_length=${plan.fingerprint?.length ?? 0}`);
  console.log(
    `[production-reset:dry-run] Execute requires: --execute --simulate --target=${EXECUTE_TARGET_QA_CLONE} --confirm=${RESET_CONFIRM_VALUE} --plan-fingerprint=<fingerprint>`,
  );
}

/**
 * @param {ReturnType<typeof parseProductionResetArgs> & { mode: "execute" }} parsed
 */
async function runExecutePath(parsed) {
  const qaEnv = loadQaCloneEnv();
  const result = await runProductionResetExecute({
    target: parsed.target,
    simulate: parsed.simulate,
    planFingerprint: parsed.planFingerprint,
    env: qaEnv,
    recomputePlan: () => buildProductionResetPlan(qaEnv),
  });
  printExecuteSimulateSummary(result);
  return 0;
}

/**
 * @param {string[]} [argv]
 */
export async function main(argv = process.argv.slice(2)) {
  const parsed = parseProductionResetArgs(argv);
  if (parsed.mode === "rejected") {
    console.error(`[production-reset] ${parsed.error}`);
    return 1;
  }

  if (parsed.mode === "execute") {
    try {
      return await runExecutePath(parsed);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  const env =
    parsed.target === EXECUTE_TARGET_QA_CLONE ? loadQaCloneEnv() : loadProductionEnv();
  const plan = await buildProductionResetPlan(env);

  writePlanReport(plan);
  printDryRunSummary(plan, { target: parsed.target });
  return dryRunExitCode(plan);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  main().then((code) => process.exit(code ?? 0));
}
