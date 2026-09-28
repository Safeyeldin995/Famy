import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FixtureRegistrySnapshot } from "@/lib/qa/integrationFixtureRegistry";

export const BABYSITTING_TEARDOWN_PLAN_VERSION = "pr67-babysitting-teardown-v1";
export const FINGERPRINT_HEX = /^[0-9a-f]{64}$/;
export const PENDING_TEARDOWN_STATUS = "pending_owner_approval";

export type ContainmentAction = {
  entityType: string;
  id: string;
  actionType: string;
  currentState?: unknown;
  intendedState?: unknown;
};

export type BabysittingContainmentPlan = {
  fingerprint: string;
  version?: string;
  actions: ContainmentAction[];
  /** Full containment plan object executed on resume — not rebuilt. */
  plan: Record<string, unknown>;
};

export type BabysittingTeardownPlan = {
  version: typeof BABYSITTING_TEARDOWN_PLAN_VERSION;
  snapshot: FixtureRegistrySnapshot;
  containment: BabysittingContainmentPlan;
};

export type OwnerTeardownApproval = {
  fingerprint: string;
  plan: BabysittingTeardownPlan;
};

export type PendingBabysittingTeardown = {
  status: typeof PENDING_TEARDOWN_STATUS;
  residueActive: true;
  automaticContainmentIsReadOnly: false;
  writesPerformed: false;
  fingerprint: string;
  plan: BabysittingTeardownPlan;
  adminEmail: string | null;
  resume: string;
};

export class PendingBabysittingTeardownError extends Error {
  readonly pending: PendingBabysittingTeardown;

  constructor(pending: PendingBabysittingTeardown) {
    super(
      `[qa-containment] babysitting fixtures remain active; owner-approved fingerprint required to resume teardown. fingerprint=${pending.fingerprint}`,
    );
    this.name = "PendingBabysittingTeardownError";
    this.pending = pending;
  }
}

function sortedIds(ids: string[]) {
  return [...ids].sort();
}

function sortedLinks<T extends Record<string, string>>(links: T[], key: (row: T) => string) {
  return [...links].sort((a, b) => key(a).localeCompare(key(b)));
}

function canonicalSnapshot(snapshot: FixtureRegistrySnapshot) {
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

export function fingerprintBabysittingTeardownPlan(plan: BabysittingTeardownPlan): string {
  if (plan.version !== BABYSITTING_TEARDOWN_PLAN_VERSION) {
    throw new Error(
      `[qa-containment] unsupported babysitting teardown plan version: ${String(plan.version)}`,
    );
  }
  const actions = [...plan.containment.actions]
    .map((row) => ({
      entityType: row.entityType,
      id: row.id,
      actionType: row.actionType,
    }))
    .sort((a, b) =>
      `${a.entityType}:${a.id}:${a.actionType}`.localeCompare(
        `${b.entityType}:${b.id}:${b.actionType}`,
      ),
    );
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: plan.version,
        snapshot: canonicalSnapshot(plan.snapshot),
        containmentFingerprint: plan.containment.fingerprint,
        actions,
      }),
    )
    .digest("hex");
}

export function assertOwnerApprovedTeardown(args: {
  approval?: OwnerTeardownApproval | null;
  currentPlan: BabysittingTeardownPlan;
}) {
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
  const current = fingerprintBabysittingTeardownPlan(args.currentPlan);
  if (current !== approval.fingerprint) {
    throw new Error(
      "[qa-containment] teardown plan drifted from the owner-approved fingerprint — rebuild dry-run and re-approve",
    );
  }
}

export function buildPendingTeardownRecord(
  plan: BabysittingTeardownPlan,
  extras?: { adminEmail?: string | null },
): PendingBabysittingTeardown {
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
      "Fixtures remain active. This record is a dry-run, not cleanup. Do not rerun the mutating suite. Review the fingerprint, then resume with PR67_TEARDOWN_PLAN_FINGERPRINT and this pending file.",
  };
}

export function persistPendingTeardown(pending: PendingBabysittingTeardown, persistPath: string) {
  mkdirSync(path.dirname(persistPath), { recursive: true });
  writeFileSync(persistPath, `${JSON.stringify(pending, null, 2)}\n`);
  return persistPath;
}

export function containmentSnapshotFrom(snapshot: FixtureRegistrySnapshot) {
  return {
    userIds: snapshot.userIds,
    adminUserIds: snapshot.adminUserIds,
    serviceIds: snapshot.serviceIds,
    providerIds: snapshot.providerIds,
    bookingIds: snapshot.bookingIds,
  };
}

export function buildBabysittingTeardownPlan(
  snapshot: FixtureRegistrySnapshot,
  containmentPlan: {
    fingerprint?: string | null;
    version?: string;
    actions?: ContainmentAction[];
    blocked?: boolean;
  } & Record<string, unknown>,
): BabysittingTeardownPlan {
  const fingerprint = containmentPlan.fingerprint;
  if (typeof fingerprint !== "string" || !FINGERPRINT_HEX.test(fingerprint)) {
    throw new Error(
      `[qa-containment] babysitting dry-run containment fingerprint missing or malformed: ${String(fingerprint)}`,
    );
  }
  return {
    version: BABYSITTING_TEARDOWN_PLAN_VERSION,
    snapshot,
    containment: {
      fingerprint,
      version: containmentPlan.version,
      actions: containmentPlan.actions ?? [],
      plan: containmentPlan,
    },
  };
}
