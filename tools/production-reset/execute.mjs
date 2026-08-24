import { createClient } from "@supabase/supabase-js";
import {
  EXECUTE_TARGET_PRODUCTION,
  EXECUTE_TARGET_QA_CLONE,
} from "./constants.mjs";
import { buildProductionResetPlan } from "./plan.mjs";
import { runSimulatedExecutePhases } from "./execute-phases.mjs";
import { buildSqlRollbackDeps } from "./execute-rollback-deps.mjs";

/**
 * Hard gate: Production execute is not available in Stage 2.
 *
 * @param {string | undefined} target
 */
export function assertExecuteTargetAllowed(target) {
  if (target === EXECUTE_TARGET_PRODUCTION) {
    throw new Error(
      "[production-reset:execute] --target=production is not available — Production execute is out of scope",
    );
  }
  if (target !== EXECUTE_TARGET_QA_CLONE) {
    throw new Error(
      `[production-reset:execute] Execute requires --target=${EXECUTE_TARGET_QA_CLONE}`,
    );
  }
}

/**
 * Stage 2: only simulation may run until explicitly approved later.
 *
 * @param {boolean | undefined} simulate
 */
export function assertSimulateModeRequired(simulate) {
  if (!simulate) {
    throw new Error(
      "[production-reset:execute] Non-simulate execute is not approved — pass --simulate",
    );
  }
}

/**
 * Recompute plan at execute time and refuse stale fingerprints.
 *
 * @param {() => Promise<Awaited<ReturnType<typeof buildProductionResetPlan>>>} recomputePlan
 * @param {string} expectedFingerprint
 */
export async function assertLiveFingerprintMatches(recomputePlan, expectedFingerprint) {
  const livePlan = await recomputePlan();
  if (livePlan.blocked) {
    throw new Error(
      `[production-reset:execute] Live plan blocked: ${livePlan.blockedReason ?? "unknown"}`,
    );
  }
  if (!livePlan.fingerprint) {
    throw new Error("[production-reset:execute] Live plan has no fingerprint");
  }
  if (livePlan.fingerprint !== expectedFingerprint) {
    throw new Error(
      "[production-reset:execute] Plan fingerprint drift — re-run dry-run against the current QA-clone target",
    );
  }
  return livePlan;
}

/**
 * @param {{
 *   target: string | undefined;
 *   simulate: boolean | undefined;
 *   planFingerprint: string | undefined;
 *   env: import("./load-qa-clone-env.mjs").loadQaCloneEnv extends () => infer R ? R : never;
 *   recomputePlan?: () => Promise<Awaited<ReturnType<typeof buildProductionResetPlan>>>;
 *   phaseRunner?: typeof runSimulatedExecutePhases;
 *   sqlDeps?: Parameters<typeof runSimulatedExecutePhases>[2];
 * }} options
 */
export async function runProductionResetExecute(options) {
  assertExecuteTargetAllowed(options.target);
  assertSimulateModeRequired(options.simulate);

  if (!options.planFingerprint) {
    throw new Error("[production-reset:execute] Missing plan fingerprint");
  }

  const recomputePlan =
    options.recomputePlan ??
    (() => buildProductionResetPlan(options.env));

  const livePlan = await assertLiveFingerprintMatches(recomputePlan, options.planFingerprint);
  const phaseRunner = options.phaseRunner ?? runSimulatedExecutePhases;

  let sqlDeps = options.sqlDeps;
  if (!sqlDeps && options.env.databaseUrl) {
    const admin = createClient(options.env.url, options.env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    sqlDeps = buildSqlRollbackDeps(admin, livePlan);
  }

  const execution = await phaseRunner(livePlan, options.env, sqlDeps ?? {});

  return {
    plan: livePlan,
    execution,
  };
}

/**
 * @param {Awaited<ReturnType<typeof runProductionResetExecute>>} result
 */
export function printExecuteSimulateSummary(result) {
  const { plan, execution } = result;
  console.log("[production-reset:execute:simulate] No committed mutations.");
  console.log(`[production-reset:execute:simulate] masked_project_ref=${plan.maskedProjectRef}`);
  console.log(`[production-reset:execute:simulate] plan_fingerprint=${plan.fingerprint}`);
  console.log(`[production-reset:execute:simulate] data_mutated=${execution.dataMutated}`);
  console.log(`[production-reset:execute:simulate] rollback_verified=${execution.rollbackVerified}`);
  if (execution.rollbackVerificationNote) {
    console.log(
      `[production-reset:execute:simulate] rollback_verification_note=${execution.rollbackVerificationNote}`,
    );
  }
  console.log("[production-reset:execute:simulate] phases:");
  for (const phase of execution.phases) {
    console.log(`[production-reset:execute:simulate]   phase=${phase.phase} ${phase.description}`);
    if (phase.sql) {
      console.log(`[production-reset:execute:simulate]     sql=${phase.sql}`);
    }
    if (phase.rowCounts) {
      console.log(
        `[production-reset:execute:simulate]     closure_tables=${phase.tablesInClosure} bound_row_counts=${phase.rowCounts.length}`,
      );
    }
    if (typeof phase.serviceDeleteCount === "number") {
      console.log(
        `[production-reset:execute:simulate]     service_delete_count=${phase.serviceDeleteCount}`,
      );
    }
    if (typeof phase.authUsersDeleteCount === "number") {
      console.log(
        `[production-reset:execute:simulate]     auth_users_delete_count=${phase.authUsersDeleteCount}`,
      );
    }
    if (typeof phase.storageObjectCount === "number") {
      console.log(
        `[production-reset:execute:simulate]     storage_object_count=${phase.storageObjectCount}`,
      );
    }
    if (phase.simulation) {
      console.log(
        `[production-reset:execute:simulate]     simulation_mode=${phase.simulation.mode} rolled_back=${phase.simulation.rolledBack} data_unchanged_verified=${phase.simulation.dataUnchangedVerified}`,
      );
    }
    if (phase.simulateOnly) {
      console.log("[production-reset:execute:simulate]     api_calls_skipped=true");
    }
  }
}
