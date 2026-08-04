import fs from "node:fs";
import path from "node:path";
import { loadQaEnv } from "./load-qa-env.mjs";
import { assertQaWriteGuard } from "./env-guard.mjs";
import { getSupabaseAdmin } from "./admin-client.mjs";
import { maskUserId } from "./qa-classification.mjs";
import { QA_CONTAINMENT_NOTE, QA_CONTAINMENT_REASON_CODE } from "./containment-booking-lifecycle.mjs";
import {
  buildContainmentPlanFromAdmin,
  sanitizeContainmentPlanForReport,
} from "./containment-planner.mjs";
import {
  disableAuthIdentity,
  removePrivilegedAdminRole,
  suspendQaProfile,
} from "./teardown-terminal-disable.mjs";
import { disableRetainedProvider, verifyProviderMarketplaceIneligible } from "./teardown-retained-provider.mjs";
import {
  authenticateBookingCaller,
  revokeBookingCallerSession,
  verifyBookingCancelled,
} from "./containment-booking-caller.mjs";
import {
  INVALIDATED_CONTAINMENT_FINGERPRINT_V1,
  INVALIDATED_CONTAINMENT_FINGERPRINT_V2,
} from "./containment-fingerprint.mjs";

function guardBeforeContainmentWrite() {
  loadQaEnv({ required: true });
  assertQaWriteGuard(process.env);
}

/**
 * @param {ReturnType<typeof buildContainmentPlanFromAdmin> extends Promise<infer P> ? P : never} freshPlan
 * @param {string | undefined} expectedFingerprint
 */
export function assertContainmentPlanApproved(freshPlan, expectedFingerprint) {
  if (freshPlan.blocked) {
    throw new Error(`[qa-containment] plan blocked: ${freshPlan.blockedReason ?? "unknown"}`);
  }
  if (!expectedFingerprint) {
    throw new Error("[qa-containment] execute requires --plan-fingerprint from dry-run");
  }
  if (
    expectedFingerprint === INVALIDATED_CONTAINMENT_FINGERPRINT_V1
    || expectedFingerprint === INVALIDATED_CONTAINMENT_FINGERPRINT_V2
  ) {
    throw new Error("[qa-containment] plan fingerprint invalidated — rebuild dry-run and re-approve");
  }
  if (freshPlan.fingerprint !== expectedFingerprint) {
    throw new Error("[qa-containment] plan fingerprint mismatch — rebuild dry-run and re-approve");
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {Awaited<ReturnType<typeof buildContainmentPlanFromAdmin>>} plan
 * @param {{
 *   bookingRpcClient?: import('@supabase/supabase-js').SupabaseClient;
 *   integrationMode?: boolean;
 *   authDeps?: Parameters<typeof authenticateBookingCaller>[2];
 * }} [options]
 */
export async function executeContainmentPlan(admin, plan, options = {}) {
  if (plan.blocked) {
    throw new Error(`[qa-containment] plan blocked: ${plan.blockedReason ?? "unknown"}`);
  }

  /** @type {Array<{ entityType: string; maskedId: string; actionType: string; ok: boolean; reason?: string }>} */
  const results = [];
  const bookingActions = plan.actions.filter((row) => row.actionType === "cancel_booking");
  const callerUserId = plan.bookingCaller?.userId ?? null;
  const reasonId = plan.cancellationReasonId ?? await resolveReasonId(admin, QA_CONTAINMENT_REASON_CODE);

  /** @type {string | null} */
  let callerAccessToken = null;
  /** @type {import('@supabase/supabase-js').SupabaseClient | null} */
  let bookingRpcClient = options.bookingRpcClient ?? null;
  let mutationsStarted = false;

  const pushResult = (row) => {
    results.push(row);
    if (row.ok) mutationsStarted = true;
  };

  const revokeCallerSession = async () => {
    if (!callerAccessToken) return { ok: true };
    const revoked = await revokeBookingCallerSession(admin, callerAccessToken);
    callerAccessToken = null;
    return revoked;
  };

  try {
    if (bookingActions.length) {
      if (options.integrationMode) {
        if (!bookingRpcClient) {
          return {
            results,
            aborted: true,
            mutationsStarted: false,
            activeOperationalResidueReduced: false,
            reason: "integration-requires-booking-rpc-client",
          };
        }
      } else {
        if (!callerUserId) {
          return {
            results,
            aborted: true,
            mutationsStarted: false,
            activeOperationalResidueReduced: false,
            reason: "missing-booking-caller",
          };
        }
        const auth = await authenticateBookingCaller(admin, callerUserId, options.authDeps);
        if (!auth.ok || !auth.rpcClient || !auth.accessToken) {
          return {
            results,
            aborted: true,
            mutationsStarted: false,
            activeOperationalResidueReduced: false,
            reason: auth.reason ?? "caller-authentication-failed",
          };
        }
        bookingRpcClient = auth.rpcClient;
        callerAccessToken = auth.accessToken;
      }

      for (const action of bookingActions) {
        const maskedId = action.maskedId ?? maskUserId(String(action.id));
        if (!bookingRpcClient || !reasonId) {
          pushResult({
            entityType: "booking",
            maskedId,
            actionType: action.actionType,
            ok: false,
            reason: !reasonId ? "missing-cancellation-reason-id" : "missing-booking-rpc-client",
          });
          await revokeCallerSession();
          return {
            results,
            aborted: true,
            mutationsStarted,
            activeOperationalResidueReduced: false,
            reason: "booking-cancel-prerequisites-missing",
          };
        }

        const { error } = await bookingRpcClient.rpc("cancel_booking", {
          p_booking_id: action.id,
          p_reason_id: reasonId,
          p_note: QA_CONTAINMENT_NOTE,
        });
        const ok = !error;
        pushResult({
          entityType: "booking",
          maskedId,
          actionType: action.actionType,
          ok,
          reason: error?.message,
        });
        if (!ok) {
          await revokeCallerSession();
          return {
            results,
            aborted: true,
            mutationsStarted,
            activeOperationalResidueReduced: false,
            reason: "booking-cancellation-failed",
          };
        }
      }

      for (const action of bookingActions) {
        const verified = await verifyBookingCancelled(admin, action.id);
        if (!verified.ok) {
          await revokeCallerSession();
          return {
            results,
            aborted: true,
            mutationsStarted,
            activeOperationalResidueReduced: false,
            reason: verified.reason ?? "booking-cancel-verification-failed",
          };
        }
      }

      await revokeCallerSession();
    }

    const serviceActions = plan.actions.filter((row) => row.actionType === "deactivate_service");
    const providerActions = plan.actions.filter((row) => row.actionType === "disable_provider");
    const identityActions = plan.actions.filter((row) => row.entityType === "identity");
    const callerIdentityActions = identityActions.filter((row) => row.id === callerUserId);
    const otherIdentityActions = identityActions.filter((row) => row.id !== callerUserId);

    for (const action of serviceActions) {
      const failed = await executePlannedActions(admin, [action], pushResult, { results, mutationsStarted });
      if (failed) return failed;
    }
    for (const action of providerActions) {
      const failed = await executePlannedActions(admin, [action], pushResult, { results, mutationsStarted });
      if (failed) return failed;
    }
    for (const action of otherIdentityActions) {
      const failed = await executePlannedActions(admin, [action], pushResult, { results, mutationsStarted });
      if (failed) return failed;
    }
    for (const action of callerIdentityActions) {
      const failed = await executePlannedActions(admin, [action], pushResult, { results, mutationsStarted });
      if (failed) return failed;
    }

    const allOk = results.every((row) => row.ok);
    return {
      results,
      aborted: false,
      mutationsStarted,
      activeOperationalResidueReduced: allOk && !plan.blocked,
      sessionRevocation: callerAccessToken ? "unverified" : "revoked-or-not-needed",
    };
  } finally {
    if (callerAccessToken) {
      await revokeBookingCallerSession(admin, callerAccessToken);
    }
  }
}

function abortExecution(results, state) {
  return {
    results,
    aborted: true,
    mutationsStarted: state.mutationsStarted,
    activeOperationalResidueReduced: false,
    reason: state.reason,
    sessionRevocation: state.sessionRevocation ?? "not-applicable",
  };
}

function latestResultFailed(results) {
  const last = results[results.length - 1];
  return Boolean(last && !last.ok);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {Array<{ entityType: string; id?: string; maskedId?: string; actionType: string }>} actions
 * @param {(row: { entityType: string; maskedId: string; actionType: string; ok: boolean; reason?: string }) => void} pushResult
 * @param {{ results: Array<unknown>; mutationsStarted: boolean; reason?: string }} state
 */
async function executePlannedActions(admin, actions, pushResult, state) {
  for (const action of actions) {
    await executePlannedAction(admin, action, pushResult);
    if (latestResultFailed(state.results)) {
      return abortExecution(state.results, {
        mutationsStarted: state.mutationsStarted,
        reason: "required-action-failed",
      });
    }
  }
  return null;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {{ entityType: string; id?: string; maskedId?: string; actionType: string }} action
 * @param {(row: { entityType: string; maskedId: string; actionType: string; ok: boolean; reason?: string }) => void} pushResult
 */
async function executePlannedAction(admin, action, pushResult) {
  const maskedId = action.maskedId ?? maskUserId(String(action.id));
  const entityId = action.id;
  if (!entityId) {
    pushResult({
      entityType: action.entityType,
      maskedId,
      actionType: action.actionType,
      ok: false,
      reason: "missing-entity-id",
    });
    return;
  }

  try {
    if (action.actionType === "ban_auth") {
      const disable = await disableAuthIdentity(admin, entityId);
      pushResult({
        entityType: "identity",
        maskedId,
        actionType: action.actionType,
        ok: disable.ok,
        reason: disable.ok ? undefined : disable.reason,
      });
      return;
    }

    if (action.actionType === "suspend_profile") {
      const suspend = await suspendQaProfile(admin, entityId);
      pushResult({
        entityType: "identity",
        maskedId,
        actionType: action.actionType,
        ok: suspend.ok,
      });
      return;
    }

    if (action.actionType === "remove_admin_role") {
      const removed = await removePrivilegedAdminRole(admin, entityId);
      pushResult({
        entityType: "identity",
        maskedId,
        actionType: action.actionType,
        ok: removed.ok,
      });
      return;
    }

    if (action.actionType === "deactivate_service") {
      const { error } = await admin.from("services").update({ is_active: false }).eq("id", entityId);
      pushResult({
        entityType: "service",
        maskedId,
        actionType: action.actionType,
        ok: !error,
        reason: error?.message,
      });
      return;
    }

    if (action.actionType === "disable_provider") {
      await disableRetainedProvider(admin, entityId);
      const check = await verifyProviderMarketplaceIneligible(admin, entityId);
      pushResult({
        entityType: "provider",
        maskedId,
        actionType: action.actionType,
        ok: check.ineligible,
        reason: check.reason,
      });
      return;
    }

    pushResult({
      entityType: action.entityType,
      maskedId,
      actionType: action.actionType,
      ok: false,
      reason: "unknown-action-type",
    });
  } catch (error) {
    pushResult({
      entityType: action.entityType,
      maskedId,
      actionType: action.actionType,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} code
 */
async function resolveReasonId(admin, code) {
  const { data, error } = await admin
    .from("cancellation_reasons")
    .select("id")
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

function writeContainmentPlanReport(plan) {
  const reportDir = path.resolve(process.cwd(), "qa/report");
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, "containment-plan.json"),
    JSON.stringify(sanitizeContainmentPlanForReport(plan), null, 2),
  );
}

function printDryRunSummary(plan) {
  console.log("[qa-containment:dry-run] No data was modified.");
  console.log(`[qa-containment:dry-run] plan_version=${plan.version}`);
  if (plan.blocked) {
    console.log(`[qa-containment:dry-run] blocked=${plan.blockedReason ?? "true"}`);
    console.log(`[qa-containment:dry-run] blocked_detail=${plan.blockedDetail ?? "(none)"}`);
    return;
  }
  console.log(`[qa-containment:dry-run] planned_actions=${plan.counts.planned_actions}`);
  console.log(`[qa-containment:dry-run] excluded_identities=${plan.counts.excluded_identities}`);
  console.log(`[qa-containment:dry-run] plan_fingerprint=${plan.fingerprint}`);
  if (plan.bookingCaller) {
    console.log(`[qa-containment:dry-run] booking_caller=${plan.bookingCaller.maskedId}:${plan.bookingCaller.callerClass}`);
  }
  if (plan.callerAuthMode) {
    console.log(`[qa-containment:dry-run] caller_auth_mode=${plan.callerAuthMode}`);
  }
  console.log(`[qa-containment:dry-run] masked_actions=${plan.actions.map((row) => `${row.entityType}:${row.maskedId}:${row.actionType}`).join(", ") || "(none)"}`);
  console.log(`[qa-containment:dry-run] masked_excluded=${plan.excluded.map((row) => `${row.entityType}:${row.maskedId}`).join(", ") || "(none)"}`);
  console.log("[qa-containment:dry-run] Execute requires: --execute --confirm=I-UNDERSTAND-QA-CONTAINMENT --plan-fingerprint=<fingerprint>");
}

/**
 * @param {{ scope?: { userIds?: string[]; serviceIds?: string[]; providerIds?: string[]; bookingIds?: string[] } }} [options]
 */
export async function runContainmentDryRun(options = {}) {
  guardBeforeContainmentWrite();
  const admin = getSupabaseAdmin();
  const plan = await buildContainmentPlanFromAdmin(admin, options.scope ?? {});
  writeContainmentPlanReport(plan);
  printDryRunSummary(plan);
  return plan;
}

/**
 * @param {{ planFingerprint?: string; scope?: { userIds?: string[]; serviceIds?: string[]; providerIds?: string[]; bookingIds?: string[] }; authDeps?: Parameters<typeof authenticateBookingCaller>[2] }} [options]
 */
export async function runContainmentExecute(options = {}) {
  guardBeforeContainmentWrite();
  const admin = getSupabaseAdmin();
  const freshPlan = await buildContainmentPlanFromAdmin(admin, options.scope ?? {});
  assertContainmentPlanApproved(freshPlan, options.planFingerprint);
  const execution = await executeContainmentPlan(admin, freshPlan, {
    authDeps: options.authDeps,
  });
  const success = !execution.aborted
    && execution.results.length > 0
    && execution.results.every((row) => row.ok)
    && execution.activeOperationalResidueReduced;
  return { plan: freshPlan, execution, success };
}

/**
 * @param {{ plan: Awaited<ReturnType<typeof buildContainmentPlanFromAdmin>>; execution: Awaited<ReturnType<typeof executeContainmentPlan>>; success: boolean }} payload
 */
export function printExecuteSummary(payload) {
  const { plan, execution } = payload;
  console.log(`[qa-containment:execute] plan_version=${plan.version}`);
  console.log(`[qa-containment:execute] plan_fingerprint=${plan.fingerprint}`);
  console.log(`[qa-containment:execute] aborted=${execution.aborted ? "true" : "false"}`);
  if (execution.reason) {
    console.log(`[qa-containment:execute] reason=${execution.reason}`);
  }
  console.log(`[qa-containment:execute] mutations_started=${execution.mutationsStarted ? "true" : "false"}`);
  console.log(`[qa-containment:execute] active_operational_residue_reduced=${execution.activeOperationalResidueReduced ? "true" : "false"}`);
  console.log(`[qa-containment:execute] session_revocation=${execution.sessionRevocation ?? "unknown"}`);
  console.log(`[qa-containment:execute] masked_results=${execution.results.map((row) => `${row.entityType}:${row.maskedId}:${row.actionType}:${row.ok ? "ok" : "fail"}`).join(", ") || "(none)"}`);
}

export {
  guardBeforeContainmentWrite,
  writeContainmentPlanReport,
  printDryRunSummary,
};
