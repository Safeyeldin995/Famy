import { getSupabaseAdmin } from "./admin-client.mjs";
import { readRegistry, removeRegistryUsers, recordRecoveryFailure } from "./registry.mjs";
import fs from "fs";
import path from "path";
import { assertNoPendingRestorations, restorePendingRestorations } from "./restoration-registry.mjs";
import { assertQaWriteGuard } from "./env-guard.mjs";
import { loadQaEnv } from "./load-qa-env.mjs";
import {
  isDestructiveCleanupEligible,
  isDeterministicQaEmail,
  maskUserId,
} from "./qa-classification.mjs";
import { disableRetainedProviders } from "./teardown-retained-provider.mjs";
import { OUTCOME_LABELS, TERMINAL_DISABLE_OUTCOMES } from "./teardown-outcomes.mjs";
import { listAllAuthUsers } from "./list-users-paginated.mjs";
import {
  executePlanDeletionSlice,
  isCoOwnedDeletion,
  isIdentityDeletion,
  isSharedResourceDeletion,
} from "./teardown-operations.mjs";
import { firstLocatorToken } from "./teardown-row-locators.mjs";
import {
  executeUserCleanupMutations,
  finalizeUserCleanupOutcome,
} from "./teardown-user-lifecycle.mjs";
import {
  assertExecutePlanApproved,
  buildCleanupPlan,
  sanitizePlanForReport,
} from "./teardown-planner.mjs";
import { computeHonestResidueMetrics } from "./teardown-residue-metrics.mjs";

function guardBeforeWrite() {
  loadQaEnv({ required: true });
  assertQaWriteGuard(process.env);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 * @param {Set<string>} registryIds
 */
export async function assessDestructiveCleanupEligibility(admin, userId, registryIds) {
  const inRegistry = registryIds.has(userId);
  const [{ data: authData }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);

  const email = authData.user?.email ?? null;
  const fullName = profile?.full_name ?? null;

  if (!authData.user) {
    return { eligible: false, reason: "missing-auth-user", email, fullName, inRegistry };
  }

  const eligible = isDestructiveCleanupEligible({ email, fullName, inRegistry });
  return {
    eligible,
    reason: eligible ? "eligible" : "insufficient-qa-signals",
    email,
    fullName,
    inRegistry,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 */
export async function collectAllQaCandidateUserIds(admin) {
  const reg = readRegistry();
  const registryIds = new Set((reg.users ?? []).map((u) => u.userId).filter(Boolean));
  const ids = new Set();

  const deterministicAuthUsers = await listAllAuthUsers(admin, (user) => isDeterministicQaEmail(user.email));
  for (const user of deterministicAuthUsers) ids.add(user.id);

  const { data: taggedProfiles } = await admin.from("profiles").select("id,full_name").ilike("full_name", "QA_%");
  for (const profile of taggedProfiles ?? []) ids.add(profile.id);

  for (const userId of registryIds) ids.add(userId);

  return { ids: [...ids], registryIds: [...registryIds] };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 */
export async function collectQaCandidateUserIds(admin) {
  const { ids, registryIds } = await collectAllQaCandidateUserIds(admin);
  const registrySet = new Set(registryIds);
  /** @type {string[]} */
  const eligible = [];

  for (const userId of ids) {
    const assessment = await assessDestructiveCleanupEligibility(admin, userId, registrySet);
    if (assessment.eligible) eligible.push(userId);
  }

  return { ids: eligible, registryIds };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 */
export async function buildAuthoritativeCleanupPlan(admin) {
  const { ids, registryIds } = await collectAllQaCandidateUserIds(admin);
  return buildCleanupPlan({
    admin,
    candidateUserIds: ids,
    registryIds: new Set(registryIds),
    assessEligibility: assessDestructiveCleanupEligibility,
  });
}

/**
 * @param {Array<{ ownerUserIds?: string[]; table: string; phase: string; locator: import("./teardown-row-locators.mjs").RowLocator }>} coOwnedRows
 * @param {Array<ReturnType<import("./teardown-errors.mjs").formatTeardownError>>} errors
 */
function buildCoOwnedFailures(coOwnedRows, errors) {
  /** @type {Array<{ ownerUserIds: string[]; table: string; phase: string; reason: string; errors: unknown[] }>} */
  const failures = [];
  if (!errors.length) return failures;

  for (const row of coOwnedRows) {
    failures.push({
      ownerUserIds: [...(row.ownerUserIds ?? [])].sort(),
      table: row.table,
      phase: row.phase,
      reason: "co-owned-delete-failed",
      errors,
    });
  }
  return failures;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {ReturnType<typeof buildCleanupPlan> extends Promise<infer P> ? P : never} plan
 */
export async function executeApprovedCleanupPlan(admin, plan) {
  guardBeforeWrite();

  /** @type {string[]} */
  const succeeded = [];
  /** @type {Array<{ userId: string; reason: string }>} */
  const refused = plan.refusedUsers.map((row) => ({ userId: row.userId, reason: row.reason }));
  /** @type {Array<{ userId: string; reason: string; errors?: unknown[] }>} */
  const failed = [];
  /** @type {Array<{ userId: string; reason: string }>} */
  const retained = [];
  /** @type {Array<{ resourceKey: string; table: string; reason: string; errors?: unknown[] }>} */
  const resourceFailures = [];

  const coOwnedDeletions = plan.deletions.filter((row) => isCoOwnedDeletion(row));
  const singleOwnerDeletions = plan.deletions.filter((row) =>
    !isCoOwnedDeletion(row) && !isSharedResourceDeletion(row) && !isIdentityDeletion(row),
  );
  const resourceDeletions = plan.deletions.filter((row) => isSharedResourceDeletion(row));

  const coOwnedSlice = await executePlanDeletionSlice(admin, coOwnedDeletions);
  const coOwnedFailures = buildCoOwnedFailures(coOwnedDeletions, coOwnedSlice.errors);

  /** @type {Map<string, Awaited<ReturnType<typeof executeUserCleanupMutations>>>} */
  const mutationByUser = new Map();

  for (const user of plan.eligibleUsers) {
    const coOwnedBlocked = !coOwnedSlice.ok
      && coOwnedFailures.some((row) => row.ownerUserIds.includes(user.userId));
    mutationByUser.set(
      user.userId,
      await executeUserCleanupMutations(admin, user.userId, {
        deletions: singleOwnerDeletions,
        retained: plan.retained,
        coOwnedBlocked,
      }),
    );
  }

  const resourceSlice = await executePlanDeletionSlice(admin, resourceDeletions);
  if (!resourceSlice.ok) {
    for (const row of resourceDeletions) {
      const token = firstLocatorToken(row);
      resourceFailures.push({
        resourceKey: row.resourceKey ?? `${row.table}:${token}`,
        table: row.table,
        reason: "resource-delete-failed",
        errors: resourceSlice.errors,
      });
      recordRecoveryFailure({
        id: token,
        kind: row.table,
        reason: "resource-delete-failed",
      });
    }
  }

  for (const row of plan.retained.filter((entry) => !entry.ownerUserId)) {
    recordRecoveryFailure({ id: row.id, kind: row.table, reason: row.reason });
  }

  /** @type {Map<string, Awaited<ReturnType<typeof finalizeUserCleanupOutcome>>>} */
  const outcomes = new Map();

  for (const user of plan.eligibleUsers) {
    const relevantCoOwnedFailures = coOwnedFailures.filter((row) => row.ownerUserIds.includes(user.userId));
    const lifecycle = await finalizeUserCleanupOutcome(admin, user.userId, {
      retained: plan.retained,
      coOwnedFailures: relevantCoOwnedFailures,
      mutation: mutationByUser.get(user.userId),
    });
    outcomes.set(user.userId, lifecycle);

    if (
      lifecycle.outcome === OUTCOME_LABELS.HARD_DELETED
      || lifecycle.outcome === OUTCOME_LABELS.SUCCEEDED
    ) {
      succeeded.push(user.userId);
      continue;
    }

    if (
      TERMINAL_DISABLE_OUTCOMES.has(lifecycle.outcome)
      || lifecycle.outcome === OUTCOME_LABELS.TERMINAL_DISABLED
      || lifecycle.outcome === OUTCOME_LABELS.TERMINAL_DISABLED_VERIFIED
      || lifecycle.outcome === OUTCOME_LABELS.TERMINAL_DISABLED_SESSION_UNVERIFIED
    ) {
      retained.push({ userId: user.userId, reason: lifecycle.reason });
      recordRecoveryFailure({ id: user.userId, kind: "user", reason: lifecycle.reason });
      continue;
    }

    if (lifecycle.outcome === OUTCOME_LABELS.DISABLE_FAILED) {
      failed.push({ userId: user.userId, reason: lifecycle.reason, errors: lifecycle.errors ?? [] });
      recordRecoveryFailure({ id: user.userId, kind: "user", reason: lifecycle.reason });
      continue;
    }

    failed.push({ userId: user.userId, reason: lifecycle.reason, errors: lifecycle.errors ?? [] });
    recordRecoveryFailure({ id: user.userId, kind: "user", reason: lifecycle.reason });
  }

  if (succeeded.length) removeRegistryUsers(succeeded);

  const retainedProviderIds = [
    ...new Set(
      plan.retained
        .filter((row) => row.table === "providers" && row.reason === "retained-immutable-history")
        .map((row) => row.id),
    ),
  ];
  if (retainedProviderIds.length) {
    await disableRetainedProviders(admin, retainedProviderIds);
  }

  const aborted = !coOwnedSlice.ok
    && coOwnedDeletions.length > 0
    && plan.eligibleUsers.length > 0
    && plan.eligibleUsers.every((user) =>
      coOwnedFailures.some((row) => row.ownerUserIds.includes(user.userId)),
    );

  return { succeeded, refused, failed, retained, resourceFailures, coOwnedFailures, outcomes, aborted };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string[]} userIds
 * @param {{ execute?: boolean; registryIds?: string[] }} [options]
 */
export async function runTeardownForUserIds(admin, userIds, options = {}) {
  const execute = options.execute ?? true;
  const registryIds = new Set(
    options.registryIds ?? (readRegistry().users ?? []).map((u) => u.userId).filter(Boolean),
  );

  const plan = await buildCleanupPlan({
    admin,
    candidateUserIds: userIds,
    registryIds,
    assessEligibility: assessDestructiveCleanupEligibility,
  });

  if (!execute) {
    return {
      userCount: plan.eligibleUsers.length,
      maskedIds: plan.eligibleUsers.map((row) => row.maskedId),
      succeeded: plan.eligibleUsers.map((row) => row.userId),
      refused: plan.refusedUsers.map((row) => ({ userId: row.userId, reason: row.reason })),
      failed: [],
      retained: [],
      plan,
    };
  }

  const userResult = await executeApprovedCleanupPlan(admin, plan);
  return {
    userCount: userResult.succeeded.length,
    maskedIds: userResult.succeeded.map(maskUserId),
    succeeded: userResult.succeeded,
    refused: userResult.refused,
    failed: userResult.failed,
    retained: userResult.retained,
    resourceFailures: userResult.resourceFailures,
    outcomes: userResult.outcomes,
    plan,
  };
}

function writeCleanupPlanReport(plan) {
  const reportDir = path.resolve(process.cwd(), "qa/report");
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "cleanup-plan.json"), JSON.stringify(sanitizePlanForReport(plan), null, 2));
}

function printDryRunSummary(plan) {
  const counts = plan.counts;
  console.log("[qa-cleanup:dry-run] No data was modified.");
  console.log(`[qa-cleanup:dry-run] eligible_users=${counts.eligible_users}`);
  console.log(`[qa-cleanup:dry-run] refused_users=${counts.refused_users}`);
  console.log(`[qa-cleanup:dry-run] unique_owned_bookings=${counts.unique_owned_bookings}`);
  console.log(`[qa-cleanup:dry-run] booking_owner_attributions=${counts.booking_owner_attributions}`);
  console.log(`[qa-cleanup:dry-run] qa_tagged_services=${counts.qa_services}`);
  console.log(`[qa-cleanup:dry-run] qa_tagged_zones=${counts.qa_zones}`);
  console.log(`[qa-cleanup:dry-run] retained_rows=${counts.retained_rows}`);
  console.log(`[qa-cleanup:dry-run] retained_services_two_pass=${counts.retained_services_two_pass}`);
  console.log(`[qa-cleanup:dry-run] plan_fingerprint=${plan.fingerprint}`);
  console.log(`[qa-cleanup:dry-run] masked_eligible_ids=${plan.eligibleUsers.map((row) => row.maskedId).join(", ") || "(none)"}`);
  console.log(`[qa-cleanup:dry-run] masked_refused_ids=${plan.refusedUsers.map((row) => row.maskedId).join(", ") || "(none)"}`);

  for (const [table, count] of Object.entries(counts.booking_children)) {
    if (count > 0) console.log(`[qa-cleanup:dry-run] booking_child_${table}=${count}`);
  }
  for (const [table, count] of Object.entries(counts.provider_dependencies)) {
    if (count > 0) console.log(`[qa-cleanup:dry-run] provider_${table}=${count}`);
  }
  for (const [table, count] of Object.entries(counts.user_scoped)) {
    if (count > 0) console.log(`[qa-cleanup:dry-run] user_scoped_${table}=${count}`);
  }
  for (const [table, count] of Object.entries(counts.qa_resources)) {
    if (count > 0) console.log(`[qa-cleanup:dry-run] qa_resource_${table}=${count}`);
  }
}

export async function runTeardownDryRun() {
  guardBeforeWrite();
  const admin = getSupabaseAdmin();
  const plan = await buildAuthoritativeCleanupPlan(admin);
  const recovery = readRegistry().recovery ?? [];

  writeCleanupPlanReport(plan);
  printDryRunSummary(plan);
  console.log(`[qa-cleanup:dry-run] recovery_entries=${recovery.length}`);
  console.log("[qa-cleanup:dry-run] Execute requires: --execute --confirm=I-UNDERSTAND-QA-CLEANUP --plan-fingerprint=<fingerprint>");

  return {
    plan,
    candidateUserCount: plan.counts.eligible_users,
    refusedUserCount: plan.counts.refused_users,
    ownedBookingCount: plan.counts.unique_owned_bookings,
    bookingOwnerAttributions: plan.counts.booking_owner_attributions,
    maskedEligibleIds: plan.eligibleUsers.map((row) => row.maskedId),
    recoveryCount: recovery.length,
    fingerprint: plan.fingerprint,
  };
}

/**
 * Authoritative execute outcome for cleanup CLI exit codes.
 * @param {{
 *   plan: { retained: Array<{ table: string; reason: string }> };
 *   users: {
 *     succeeded: string[];
 *     refused: Array<{ userId: string }>;
 *     failed: Array<{ userId: string }>;
 *     retained: Array<{ userId: string }>;
 *     resourceFailures: Array<unknown>;
 *     coOwnedFailures?: Array<unknown>;
 *   };
 *   honestMetrics: ReturnType<typeof computeHonestResidueMetrics>;
 *   recoveryCount: number;
 *   remainingCandidates: number;
 *   aborted?: boolean;
 * }} payload
 */
export function evaluateCleanupExecuteOutcome(payload) {
  const {
    plan,
    users,
    honestMetrics,
    recoveryCount,
    remainingCandidates,
    aborted = false,
  } = payload;

  const failedUsers = users.failed.length;
  const refusedUsers = users.refused.length;
  const retainedUsers = users.retained.length;
  const resourceFailures = users.resourceFailures.length;
  const coOwnedFailures = users.coOwnedFailures?.length ?? 0;
  const retainedOperationalResources = (plan.retained ?? []).filter(
    (row) => row.table === "services" || row.table === "zones" || row.table === "payment_methods",
  ).length;

  const zeroBaselineAchieved =
    !honestMetrics.active_operational_residue
    && !honestMetrics.deletable_QA_resources
    && recoveryCount === 0
    && remainingCandidates === 0
    && honestMetrics.terminal_disabled_identities === 0;

  /** @type {string[]} */
  const failureReasons = [];
  if (aborted) failureReasons.push("aborted");
  if (failedUsers) failureReasons.push(`failed_users=${failedUsers}`);
  if (refusedUsers) failureReasons.push(`refused_users=${refusedUsers}`);
  if (retainedUsers) failureReasons.push(`retained_users=${retainedUsers}`);
  if (resourceFailures) failureReasons.push(`resource_failures=${resourceFailures}`);
  if (coOwnedFailures) failureReasons.push(`co_owned_failures=${coOwnedFailures}`);
  if (retainedOperationalResources) {
    failureReasons.push(`retained_operational_resources=${retainedOperationalResources}`);
  }
  if (honestMetrics.terminal_disabled_identities) {
    failureReasons.push(`terminal_disabled=${honestMetrics.terminal_disabled_identities}`);
  }
  if (!zeroBaselineAchieved) {
    if (honestMetrics.active_operational_residue) {
      failureReasons.push(`active_operational_residue=${honestMetrics.active_operational_residue}`);
    }
    if (honestMetrics.deletable_QA_resources) {
      failureReasons.push(`deletable_qa_resources=${honestMetrics.deletable_QA_resources}`);
    }
    if (recoveryCount) failureReasons.push(`recovery_entries=${recoveryCount}`);
    if (remainingCandidates) failureReasons.push(`remaining_candidates=${remainingCandidates}`);
  }

  const success =
    !aborted
    && failedUsers === 0
    && refusedUsers === 0
    && retainedUsers === 0
    && resourceFailures === 0
    && coOwnedFailures === 0
    && retainedOperationalResources === 0
    && zeroBaselineAchieved;

  return {
    success,
    aborted,
    zeroBaselineAchieved,
    failureReasons,
  };
}

/**
 * @param {{
 *   plan: { fingerprint: string };
 *   users: {
 *     succeeded: string[];
 *     refused: Array<unknown>;
 *     failed: Array<unknown>;
 *     retained: Array<unknown>;
 *     resourceFailures: Array<unknown>;
 *   };
 *   success: boolean;
 *   aborted: boolean;
 *   zeroBaselineAchieved: boolean;
 *   failureReasons: string[];
 *   honestMetrics?: ReturnType<typeof computeHonestResidueMetrics>;
 * }} payload
 */
export function printCleanupExecuteSummary(payload) {
  const { plan, users, success, aborted, zeroBaselineAchieved, failureReasons, honestMetrics } = payload;
  console.log(`[qa-cleanup:execute] plan_fingerprint=${plan.fingerprint}`);
  console.log(`[qa-cleanup:execute] succeeded=${users.succeeded.length} refused=${users.refused.length} failed=${users.failed.length} retained=${users.retained.length}`);
  console.log(`[qa-cleanup:execute] resource_failures=${users.resourceFailures.length}`);
  console.log(`[qa-cleanup:execute] zero_baseline=${zeroBaselineAchieved ? "achieved" : "not-achieved"}`);
  console.log(`[qa-cleanup:execute] aborted=${aborted ? "true" : "false"}`);
  console.log(`[qa-cleanup:execute] success=${success ? "true" : "false"}`);
  if (failureReasons.length) {
    console.log(`[qa-cleanup:execute] failure_reasons=${failureReasons.join(",")}`);
  }
  if (honestMetrics) {
    console.log(`[qa-cleanup:execute] terminal_disabled_identities=${honestMetrics.terminal_disabled_identities}`);
    console.log(`[qa-cleanup:execute] active_operational_residue=${honestMetrics.active_operational_residue}`);
  }
}

/**
 * Playwright global teardown — registry-scoped cleanup only.
 * Never requires a reviewed cleanup fingerprint; does not run authoritative cleanup.
 */
export async function runPlaywrightGlobalTeardown() {
  guardBeforeWrite();
  const admin = getSupabaseAdmin();
  await restorePendingRestorations();

  const reg = readRegistry();
  const registryUserIds = (reg.users ?? []).map((user) => user.userId).filter(Boolean);
  const registryIds = new Set(registryUserIds);

  if (!registryUserIds.length) {
    console.log("[qa-teardown:e2e] no registry users; skipping destructive cleanup");
    return {
      skipped: true,
      reason: "no_registry_users",
      users: {
        succeeded: [],
        refused: [],
        failed: [],
        retained: [],
        resourceFailures: [],
      },
    };
  }

  const userResult = await runTeardownForUserIds(admin, registryUserIds, {
    execute: true,
    registryIds: [...registryIds],
  });
  const plan = userResult.plan;
  const recovery = readRegistry().recovery ?? [];

  await restorePendingRestorations();
  assertNoPendingRestorations();

  const reportDir = path.resolve(process.cwd(), "qa/report");
  fs.mkdirSync(reportDir, { recursive: true });
  const honestMetrics = computeHonestResidueMetrics({
    plan,
    outcomes: userResult.outcomes,
    succeeded: userResult.succeeded,
    failed: userResult.failed,
    retainedUsers: userResult.retained,
  });

  fs.writeFileSync(path.join(reportDir, "residue.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    mode: "playwright-global-teardown",
    plan_fingerprint: plan.fingerprint,
    succeeded_users: userResult.succeeded.map(maskUserId),
    refused_users: userResult.refused.map((row) => ({ id: maskUserId(row.userId), reason: row.reason })),
    failed_users: userResult.failed.map((row) => ({ id: maskUserId(row.userId), reason: row.reason })),
    retained_users: userResult.retained.map((row) => ({ id: maskUserId(row.userId), reason: row.reason })),
    retained_resources: plan.retained.map((row) => ({ table: row.table, id: maskUserId(row.id), reason: row.reason })),
    honest_residue_metrics: honestMetrics,
    recovery_entries: recovery.length,
  }, null, 2));

  console.log(`[qa-teardown:e2e] succeeded=${userResult.succeeded.length} refused=${userResult.refused.length} failed=${userResult.failed.length} retained=${userResult.retained.length}`);
  console.log(`[qa-teardown:e2e] registry_users=${registryUserIds.length}`);

  return {
    skipped: false,
    plan,
    users: userResult,
    honestMetrics,
    recoveryCount: recovery.length,
  };
}

/**
 * @param {{ planFingerprint?: string }} [options]
 */
export async function runTeardown(options = {}) {
  guardBeforeWrite();
  const admin = getSupabaseAdmin();
  await restorePendingRestorations();

  const plan = await buildAuthoritativeCleanupPlan(admin);
  assertExecutePlanApproved(plan, options.planFingerprint);

  const userResult = await executeApprovedCleanupPlan(admin, plan);
  const postPlan = await buildAuthoritativeCleanupPlan(admin);
  const recovery = readRegistry().recovery ?? [];

  await restorePendingRestorations();
  assertNoPendingRestorations();

  const reportDir = path.resolve(process.cwd(), "qa/report");
  fs.mkdirSync(reportDir, { recursive: true });
  const honestMetrics = computeHonestResidueMetrics({
    plan,
    outcomes: userResult.outcomes,
    succeeded: userResult.succeeded,
    failed: userResult.failed,
    retainedUsers: userResult.retained,
  });

  const executeOutcome = evaluateCleanupExecuteOutcome({
    plan,
    users: userResult,
    honestMetrics,
    recoveryCount: recovery.length,
    remainingCandidates: postPlan.counts.eligible_users,
    aborted: userResult.aborted ?? false,
  });

  fs.writeFileSync(path.join(reportDir, "residue.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    plan_fingerprint: plan.fingerprint,
    succeeded_users: userResult.succeeded.map(maskUserId),
    refused_users: userResult.refused.map((row) => ({ id: maskUserId(row.userId), reason: row.reason })),
    failed_users: userResult.failed.map((row) => ({ id: maskUserId(row.userId), reason: row.reason })),
    retained_users: userResult.retained.map((row) => ({ id: maskUserId(row.userId), reason: row.reason })),
    retained_resources: plan.retained.map((row) => ({ table: row.table, id: maskUserId(row.id), reason: row.reason })),
    resource_failures: userResult.resourceFailures.map((row) => ({
      table: row.table,
      maskedId: maskUserId(row.resourceKey.split(":")[1] ?? row.resourceKey),
      reason: row.reason,
    })),
    honest_residue_metrics: honestMetrics,
    post_execute_counts: postPlan.counts,
    remaining_candidates: postPlan.counts.eligible_users,
    recovery_entries: recovery.length,
  }, null, 2));

  console.log(`[qa-teardown] succeeded=${userResult.succeeded.length} refused=${userResult.refused.length} failed=${userResult.failed.length} retained=${userResult.retained.length}`);
  console.log(`[qa-teardown] resource_failures=${userResult.resourceFailures.length}`);
  console.log(`[qa-teardown] remaining_candidate_users=${postPlan.counts.eligible_users}`);
  console.log(`[qa-teardown] remaining_owned_bookings=${postPlan.counts.unique_owned_bookings}`);

  if (!executeOutcome.zeroBaselineAchieved) {
    console.error("[qa-teardown] zero-baseline not achieved; see qa/report/residue.json");
  }

  printCleanupExecuteSummary({
    plan,
    users: userResult,
    honestMetrics,
    ...executeOutcome,
  });

  return {
    plan,
    users: userResult,
    postExecuteCounts: postPlan.counts,
    remainingCandidates: postPlan.counts.eligible_users,
    recoveryCount: recovery.length,
    honestMetrics,
    ...executeOutcome,
  };
}

export {
  buildCleanupPlan,
  sanitizePlanForReport,
  assertExecutePlanApproved,
} from "./teardown-planner.mjs";
