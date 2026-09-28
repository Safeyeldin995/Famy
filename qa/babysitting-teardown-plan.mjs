/**
 * PR67 babysitting teardown plan integrity.
 * Fingerprints the executable containment plan (not a summary-only hash).
 * Import is side-effect free.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fingerprintContainmentPlan } from "./containment-fingerprint.mjs";
import { CONTAINMENT_PLAN_VERSION } from "./containment-booking-lifecycle.mjs";
import { assertContainmentPlanApproved } from "./containment-core.mjs";
import { CONTAINMENT_CONFIRM_VALUE } from "./containment-args.mjs";

export const BABYSITTING_TEARDOWN_PLAN_VERSION = "pr67-babysitting-teardown-v3";
export const FINGERPRINT_HEX = /^[0-9a-f]{64}$/;
export const PENDING_TEARDOWN_STATUS = "pending_owner_approval";
export const DEFAULT_PENDING_TEARDOWN_PATH = "qa/report/pr67-babysitting-pending-teardown.json";
export const PR67_TEARDOWN_FINGERPRINT_ENV = "PR67_TEARDOWN_PLAN_FINGERPRINT";
export { CONTAINMENT_CONFIRM_VALUE };

const DANGEROUS_FLAGS = new Set(["--force", "--yes", "--production", "--prod", "--no-guard"]);

function sortedIds(ids) {
  return [...(ids ?? [])].sort();
}

function sortedLinks(links, key) {
  return [...(links ?? [])].sort((a, b) => key(a).localeCompare(key(b)));
}

export function canonicalSnapshot(snapshot) {
  return {
    runId: snapshot.runId,
    suite: snapshot.suite ?? null,
    userIds: sortedIds(snapshot.userIds),
    adminUserIds: sortedIds(snapshot.adminUserIds),
    addressIds: sortedIds(snapshot.addressIds),
    bookingIds: sortedIds(snapshot.bookingIds),
    serviceIds: sortedIds(snapshot.serviceIds),
    zoneIds: sortedIds(snapshot.zoneIds),
    providerIds: sortedIds(snapshot.providerIds),
    paymentIds: sortedIds(snapshot.paymentIds),
    zoneProviderLinks: sortedLinks(
      snapshot.zoneProviderLinks,
      (row) => `${row.zoneId}:${row.providerId}`,
    ),
    zoneServiceLinks: sortedLinks(
      snapshot.zoneServiceLinks,
      (row) => `${row.zoneId}:${row.serviceId}`,
    ),
    providerServiceLinks: sortedLinks(
      snapshot.providerServiceLinks,
      (row) => `${row.providerId}:${row.serviceId}`,
    ),
  };
}

function actionKey(row) {
  return `${row.entityType}:${row.id}:${row.actionType}`;
}

export function canonicalContainmentActions(actions) {
  return [...(actions ?? [])]
    .map((row) => ({
      entityType: row.entityType,
      id: row.id,
      actionType: row.actionType,
      currentState: row.currentState ?? null,
      intendedState: row.intendedState ?? null,
    }))
    .sort((a, b) => actionKey(a).localeCompare(actionKey(b)));
}

export function containmentSnapshotFrom(snapshot) {
  return {
    userIds: snapshot.userIds,
    adminUserIds: snapshot.adminUserIds,
    serviceIds: snapshot.serviceIds,
    providerIds: snapshot.providerIds,
    bookingIds: snapshot.bookingIds,
  };
}

/**
 * Recompute the shared containment hash from the deserialized executable plan.
 * This is the plan executeContainmentPlan will run — not the summary copy.
 */
export function recomputeContainmentPlanFingerprint(executablePlan) {
  const actions = canonicalContainmentActions(executablePlan?.actions);
  const bookingActions = actions.filter((row) => row.actionType === "cancel_booking");
  return fingerprintContainmentPlan(actions, executablePlan?.projectRef, {
    bookingCallerUserId: executablePlan?.bookingCaller?.userId ?? null,
    bookingCallerClass: executablePlan?.bookingCaller?.callerClass ?? null,
    callerAuthMode: executablePlan?.callerAuthMode ?? null,
    bookingCallerSelectionPolicy: executablePlan?.callerSelectionPolicy ?? null,
    eligibleCallerCount: executablePlan?.eligibleCallerCount ?? null,
    cancellationReasonId: executablePlan?.cancellationReasonId ?? null,
    bookings: bookingActions.map((row) => ({
      id: row.id,
      status: String(row.currentState ?? ""),
    })),
  });
}

export function withComputedContainmentFingerprint(executablePlan) {
  const fingerprint = recomputeContainmentPlanFingerprint(executablePlan);
  return { ...executablePlan, fingerprint };
}

function summarizeActions(actions) {
  return canonicalContainmentActions(actions).map((row) => ({
    entityType: row.entityType,
    id: row.id,
    actionType: row.actionType,
  }));
}

/**
 * Reject summary-vs-executable discrepancy and fingerprint/action drift
 * before any teardown write.
 */
export function assertExecutableContainmentIntegrity(containment) {
  const executable = containment?.plan;
  if (!executable || typeof executable !== "object" || Array.isArray(executable)) {
    throw new Error("[qa-containment] babysitting teardown missing executable containment.plan");
  }
  if (executable.blocked) {
    throw new Error(`[qa-containment] plan blocked: ${executable.blockedReason ?? "unknown"}`);
  }
  const expected = containment.fingerprint;
  if (typeof expected !== "string" || !FINGERPRINT_HEX.test(expected)) {
    throw new Error(
      `[qa-containment] babysitting dry-run containment fingerprint missing or malformed: ${String(expected)}`,
    );
  }
  const recomputed = recomputeContainmentPlanFingerprint(executable);
  if (recomputed !== expected) {
    throw new Error(
      "[qa-containment] executable containment plan does not match the bound containment fingerprint",
    );
  }
  if (typeof executable.fingerprint === "string" && executable.fingerprint !== expected) {
    throw new Error(
      "[qa-containment] nested plan fingerprint disagrees with containment fingerprint",
    );
  }
  if (
    JSON.stringify(summarizeActions(containment.actions)) !==
    JSON.stringify(summarizeActions(executable.actions))
  ) {
    throw new Error(
      "[qa-containment] containment summary actions disagree with executable plan actions",
    );
  }
  const needsCaller = canonicalContainmentActions(executable.actions).some(
    (row) => row.actionType === "cancel_booking",
  );
  if (needsCaller && !executable.bookingCaller?.userId) {
    throw new Error(
      "[qa-containment] babysitting teardown plan requires a bound run-owned booking caller before pending-booking cancel",
    );
  }
  return recomputed;
}

/**
 * Shared teardown gate: the plan about to execute must recompute to the
 * owner-supplied containment fingerprint. Format-only equality is not enough.
 */
export function assertApprovedExecutablePlan(executablePlan, expectedFingerprint) {
  if (!executablePlan || typeof executablePlan !== "object" || !expectedFingerprint) {
    throw new Error(
      "[qa-containment] fixture teardown approval is missing or does not match the bound containment plan",
    );
  }
  if (!FINGERPRINT_HEX.test(expectedFingerprint)) {
    throw new Error(
      "[qa-containment] fixture teardown fingerprint malformed — expected 64-char sha256 hex",
    );
  }
  const bound = executablePlan.fingerprint;
  if (typeof bound !== "string" || bound !== expectedFingerprint) {
    throw new Error(
      "[qa-containment] fixture teardown approval is missing or does not match the bound containment plan",
    );
  }
  const recomputed = recomputeContainmentPlanFingerprint(executablePlan);
  if (recomputed !== expectedFingerprint) {
    throw new Error(
      "[qa-containment] executable containment plan does not match the bound containment fingerprint",
    );
  }
  assertContainmentPlanApproved(executablePlan, expectedFingerprint);
  return recomputed;
}

export function fingerprintBabysittingTeardownPlan(plan) {
  if (plan?.version !== BABYSITTING_TEARDOWN_PLAN_VERSION) {
    throw new Error(
      `[qa-containment] unsupported babysitting teardown plan version: ${String(plan?.version)}`,
    );
  }
  const containmentFingerprint = assertExecutableContainmentIntegrity(plan.containment);
  const executable = plan.containment.plan;
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: plan.version,
        snapshot: canonicalSnapshot(plan.snapshot),
        containmentFingerprint,
        executable: {
          version: executable.version ?? plan.containment.version ?? CONTAINMENT_PLAN_VERSION,
          projectRef: executable.projectRef ?? null,
          bookingCallerUserId: executable.bookingCaller?.userId ?? null,
          bookingCallerClass: executable.bookingCaller?.callerClass ?? null,
          callerAuthMode: executable.callerAuthMode ?? null,
          callerSelectionPolicy: executable.callerSelectionPolicy ?? null,
          eligibleCallerCount: executable.eligibleCallerCount ?? null,
          cancellationReasonId: executable.cancellationReasonId ?? null,
          actions: canonicalContainmentActions(executable.actions),
        },
      }),
    )
    .digest("hex");
}

export function assertOwnerApprovedTeardown(args) {
  const approval = args.approval;
  if (!approval?.fingerprint) {
    throw new Error(
      "[qa-containment] babysitting teardown requires owner-approved plan fingerprint from a reviewed dry-run",
    );
  }
  if (!FINGERPRINT_HEX.test(approval.fingerprint)) {
    throw new Error(
      "[qa-containment] babysitting teardown fingerprint malformed — expected 64-char sha256 hex",
    );
  }
  if (!approval.plan) {
    throw new Error(
      "[qa-containment] babysitting teardown requires the reviewed plan bound to that fingerprint",
    );
  }
  const bound = fingerprintBabysittingTeardownPlan(approval.plan);
  if (bound !== approval.fingerprint) {
    throw new Error("[qa-containment] approval fingerprint does not match the bound reviewed plan");
  }
  if (!args.currentPlan) {
    throw new Error(
      "[qa-containment] teardown plan drifted from the owner-approved fingerprint — rebuild dry-run and re-approve",
    );
  }
  const current = fingerprintBabysittingTeardownPlan(args.currentPlan);
  if (current !== approval.fingerprint) {
    throw new Error(
      "[qa-containment] teardown plan drifted from the owner-approved fingerprint — rebuild dry-run and re-approve",
    );
  }
}

export function buildBabysittingTeardownPlan(snapshot, containmentPlan) {
  const fingerprint = containmentPlan?.fingerprint;
  if (typeof fingerprint !== "string" || !FINGERPRINT_HEX.test(fingerprint)) {
    throw new Error(
      `[qa-containment] babysitting dry-run containment fingerprint missing or malformed: ${String(fingerprint)}`,
    );
  }
  const plan = {
    version: BABYSITTING_TEARDOWN_PLAN_VERSION,
    snapshot,
    containment: {
      fingerprint,
      version: containmentPlan.version,
      actions: containmentPlan.actions ?? [],
      plan: containmentPlan,
    },
  };
  assertExecutableContainmentIntegrity(plan.containment);
  return plan;
}

export function buildPendingTeardownRecord(plan, extras) {
  const fingerprint = fingerprintBabysittingTeardownPlan(plan);
  return {
    status: PENDING_TEARDOWN_STATUS,
    residueActive: true,
    automaticContainmentIsReadOnly: false,
    writesPerformed: false,
    fingerprint,
    plan,
    adminEmail: extras?.adminEmail ?? null,
    resume:
      "Fixtures remain active. This record is a dry-run, not cleanup. Do not rerun the mutating suite. Review the fingerprint, then resume with PR67_TEARDOWN_PLAN_FINGERPRINT and this pending file via qa/pr67-babysitting-teardown-resume.mjs.",
  };
}

export function persistPendingTeardown(pending, persistPath) {
  fs.mkdirSync(path.dirname(persistPath), { recursive: true });
  fs.writeFileSync(persistPath, `${JSON.stringify(pending, null, 2)}\n`);
  return persistPath;
}

export function parsePendingTeardown(raw) {
  if (!raw || typeof raw !== "object" || raw.status !== PENDING_TEARDOWN_STATUS) {
    throw new Error("[qa-containment] pending babysitting teardown file missing or malformed");
  }
  if (raw.residueActive !== true) {
    throw new Error("[qa-containment] pending teardown conceals active residue — refuse to resume");
  }
  if (raw.automaticContainmentIsReadOnly === true) {
    throw new Error(
      "[qa-containment] pending teardown incorrectly labels automatic containment read-only",
    );
  }
  if (raw.writesPerformed === true) {
    throw new Error(
      "[qa-containment] pending teardown claims writes already performed — inspect residue; do not resume this file",
    );
  }
  if (!raw.plan || typeof raw.fingerprint !== "string") {
    throw new Error("[qa-containment] pending babysitting teardown file missing or malformed");
  }
  if (!FINGERPRINT_HEX.test(raw.fingerprint)) {
    throw new Error(
      "[qa-containment] babysitting teardown fingerprint malformed — expected 64-char sha256 hex",
    );
  }
  const bound = fingerprintBabysittingTeardownPlan(raw.plan);
  if (bound !== raw.fingerprint) {
    throw new Error(
      "[qa-containment] pending teardown fingerprint does not match the bound reviewed plan",
    );
  }
  return raw;
}

export function loadPendingTeardown(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("[qa-containment] pending babysitting teardown file missing or malformed");
  }
  return parsePendingTeardown(raw);
}

/**
 * @param {string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 */
export function parseBabysittingTeardownResumeArgs(argv = [], env = process.env) {
  const args = argv ?? [];
  const seen = new Set();
  let execute = false;
  /** @type {string | undefined} */
  let confirmValue;
  /** @type {string | undefined} */
  let planFingerprint;
  let pendingFile = DEFAULT_PENDING_TEARDOWN_PATH;

  for (const arg of args) {
    if (DANGEROUS_FLAGS.has(arg)) {
      return { mode: "rejected", error: `Dangerous teardown flag is not allowed: ${arg}` };
    }
    if (arg === "--execute") {
      if (seen.has("--execute")) {
        return { mode: "rejected", error: "Duplicate teardown flag is not allowed: --execute" };
      }
      seen.add("--execute");
      execute = true;
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      if (seen.has("--confirm")) {
        return { mode: "rejected", error: "Duplicate teardown flag is not allowed: --confirm" };
      }
      confirmValue = arg.slice("--confirm=".length);
      if (!confirmValue) {
        return { mode: "rejected", error: "Malformed teardown flag: --confirm= requires a value" };
      }
      seen.add("--confirm");
      continue;
    }
    if (arg.startsWith("--plan-fingerprint=")) {
      if (seen.has("--plan-fingerprint")) {
        return {
          mode: "rejected",
          error: "Duplicate teardown flag is not allowed: --plan-fingerprint",
        };
      }
      planFingerprint = arg.slice("--plan-fingerprint=".length);
      if (!planFingerprint || !FINGERPRINT_HEX.test(planFingerprint)) {
        return {
          mode: "rejected",
          error: "Malformed teardown flag: --plan-fingerprint must be a 64-char sha256 hex digest",
        };
      }
      seen.add("--plan-fingerprint");
      continue;
    }
    if (arg.startsWith("--pending-file=")) {
      if (seen.has("--pending-file")) {
        return {
          mode: "rejected",
          error: "Duplicate teardown flag is not allowed: --pending-file",
        };
      }
      pendingFile = arg.slice("--pending-file=".length);
      if (!pendingFile) {
        return {
          mode: "rejected",
          error: "Malformed teardown flag: --pending-file= requires a value",
        };
      }
      seen.add("--pending-file");
      continue;
    }
    if (arg.startsWith("--")) {
      return { mode: "rejected", error: `Unknown teardown flag is not allowed: ${arg}` };
    }
    return { mode: "rejected", error: `Unexpected teardown argument: ${arg}` };
  }

  if (!planFingerprint) {
    const fromEnv = env?.[PR67_TEARDOWN_FINGERPRINT_ENV]?.trim();
    if (fromEnv) {
      if (!FINGERPRINT_HEX.test(fromEnv)) {
        return {
          mode: "rejected",
          error: `${PR67_TEARDOWN_FINGERPRINT_ENV} must be a 64-char sha256 hex digest`,
        };
      }
      planFingerprint = fromEnv;
    }
  }

  if (!execute) {
    return { mode: "verify", confirmValue, planFingerprint, pendingFile };
  }

  if (confirmValue !== CONTAINMENT_CONFIRM_VALUE) {
    return {
      mode: "rejected",
      error: `Babysitting teardown execute requires --execute --confirm=${CONTAINMENT_CONFIRM_VALUE}`,
    };
  }

  if (!planFingerprint) {
    return {
      mode: "rejected",
      error:
        "Babysitting teardown execute requires --plan-fingerprint or PR67_TEARDOWN_PLAN_FINGERPRINT from the reviewed pending file — the pending fingerprint is not auto-approved",
    };
  }

  return { mode: "execute", confirmValue, planFingerprint, pendingFile };
}
