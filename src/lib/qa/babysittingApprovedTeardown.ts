import type { FixtureRegistrySnapshot } from "@/lib/qa/integrationFixtureRegistry";
// @ts-expect-error — .mjs module has no generated declarations
import * as teardownPlan from "../../../qa/babysitting-teardown-plan.mjs";

export const BABYSITTING_TEARDOWN_PLAN_VERSION =
  teardownPlan.BABYSITTING_TEARDOWN_PLAN_VERSION as "pr67-babysitting-teardown-v3";
export const FINGERPRINT_HEX = teardownPlan.FINGERPRINT_HEX as RegExp;
export const PENDING_TEARDOWN_STATUS =
  teardownPlan.PENDING_TEARDOWN_STATUS as "pending_owner_approval";
export const DEFAULT_PENDING_TEARDOWN_PATH = teardownPlan.DEFAULT_PENDING_TEARDOWN_PATH as string;

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

export const fingerprintBabysittingTeardownPlan =
  teardownPlan.fingerprintBabysittingTeardownPlan as (plan: BabysittingTeardownPlan) => string;

export const assertOwnerApprovedTeardown = teardownPlan.assertOwnerApprovedTeardown as (args: {
  approval?: OwnerTeardownApproval | null;
  currentPlan?: BabysittingTeardownPlan;
}) => void;

export const assertApprovedExecutablePlan = teardownPlan.assertApprovedExecutablePlan as (
  executablePlan: Record<string, unknown>,
  expectedFingerprint: string,
) => string;

export const buildPendingTeardownRecord = teardownPlan.buildPendingTeardownRecord as (
  plan: BabysittingTeardownPlan,
  extras?: { adminEmail?: string | null },
) => PendingBabysittingTeardown;

export const persistPendingTeardown = teardownPlan.persistPendingTeardown as (
  pending: PendingBabysittingTeardown,
  persistPath: string,
) => string;

export const containmentSnapshotFrom = teardownPlan.containmentSnapshotFrom as (
  snapshot: FixtureRegistrySnapshot,
) => {
  userIds: string[];
  adminUserIds: string[];
  serviceIds: string[];
  providerIds: string[];
  bookingIds: string[];
};

export const buildBabysittingTeardownPlan = teardownPlan.buildBabysittingTeardownPlan as (
  snapshot: FixtureRegistrySnapshot,
  containmentPlan: {
    fingerprint?: string | null;
    version?: string;
    actions?: ContainmentAction[];
    blocked?: boolean;
  } & Record<string, unknown>,
) => BabysittingTeardownPlan;

export const recomputeContainmentPlanFingerprint =
  teardownPlan.recomputeContainmentPlanFingerprint as (
    executablePlan: Record<string, unknown>,
  ) => string;

export const withComputedContainmentFingerprint =
  teardownPlan.withComputedContainmentFingerprint as <T extends Record<string, unknown>>(
    executablePlan: T,
  ) => T & { fingerprint: string };
