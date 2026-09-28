import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IntegrationFixtureRegistry } from "@/lib/qa/integrationFixtureRegistry";
import {
  BABYSITTING_TEARDOWN_PLAN_VERSION,
  assertOwnerApprovedTeardown,
  buildBabysittingTeardownPlan,
  buildPendingTeardownRecord,
  fingerprintBabysittingTeardownPlan,
  persistPendingTeardown,
  withComputedContainmentFingerprint,
  type BabysittingTeardownPlan,
} from "@/lib/qa/babysittingApprovedTeardown";
import { teardownRegisteredFixture } from "@/lib/qa/integrationFixtureTeardown";
import {
  PendingBabysittingTeardownError,
  resumeApprovedBabysittingTeardown,
} from "./babysittingCapabilities.harness";

const dryRunHolder: { plan: Record<string, unknown> | null } = { plan: null };

vi.mock("../../../../qa/containment-integration.mjs", () => ({
  containIntegrationFixtureResidue: vi.fn(
    async (
      _admin,
      _snapshot,
      options: { approvedPlan?: { fingerprint: string }; dryRun?: boolean },
    ) => {
      if (options?.dryRun) {
        return {
          plan: dryRunHolder.plan ?? {
            fingerprint: "c".repeat(64),
            actions: [],
            version: "6a.2-containment-v4",
          },
          execution: null,
        };
      }
      return {
        plan: options?.approvedPlan ?? { fingerprint: "c".repeat(64), actions: [] },
        execution: {
          results: [
            { ok: true, maskedId: "qa-u…ser", entityType: "identity", actionType: "disable_auth" },
          ],
        },
      };
    },
  ),
  buildBabysittingFixtureContainmentPlan: vi.fn(async () => {
    if (!dryRunHolder.plan) {
      throw new Error("buildBabysittingFixtureContainmentPlan must be configured for this test");
    }
    return dryRunHolder.plan;
  }),
}));

vi.mock("../../../../qa/registry.mjs", () => ({
  readRegistry: vi.fn(() => ({ users: [] })),
  recordRecoveryFailure: vi.fn(),
  removeRegistryUsers: vi.fn(),
  registerUserEntry: vi.fn(),
}));

function sampleSnapshot(registry: IntegrationFixtureRegistry) {
  registry.registerUser("user-1", { email: "qa-babysit@famio.local", admin: true });
  registry.registerService("svc-1");
  registry.registerProvider("prov-1");
  registry.registerZone("zone-1");
  registry.registerAddress("addr-1");
  registry.registerBooking("book-1");
  registry.registerZoneProvider("zone-1", "prov-1");
  registry.registerZoneService("zone-1", "svc-1");
  registry.registerProviderService("prov-1", "svc-1");
  return registry.snapshot();
}

function sampleExecutable(extras?: Record<string, unknown>) {
  return withComputedContainmentFingerprint({
    version: "6a.2-containment-v4",
    projectRef: "qa-test-ref",
    blocked: false,
    bookingCaller: { userId: "user-1", callerClass: "authenticated_qa_admin" },
    callerAuthMode: "admin_generated_magiclink",
    callerSelectionPolicy: "eligible-admin-user-id-asc-v1",
    eligibleCallerCount: 1,
    cancellationReasonId: "reason-1",
    actions: [
      {
        entityType: "booking",
        id: "book-1",
        actionType: "cancel_booking",
        currentState: "pending",
        intendedState: "cancelled",
      },
      {
        entityType: "identity",
        id: "user-1",
        actionType: "disable_auth",
        currentState: { banned: false },
        intendedState: { banned: true },
      },
    ],
    ...extras,
  });
}

function samplePlan(
  snapshot: ReturnType<IntegrationFixtureRegistry["snapshot"]>,
  extras?: Record<string, unknown>,
): BabysittingTeardownPlan {
  return buildBabysittingTeardownPlan(snapshot, sampleExecutable(extras));
}

function trackingAdmin() {
  const writes: string[] = [];
  const chain = (table: string, op: string) => {
    writes.push(`${table}.${op}`);
    const result = { error: null, data: [] as unknown[] };
    const thenable: {
      eq: ReturnType<typeof vi.fn>;
      in: ReturnType<typeof vi.fn>;
      maybeSingle: ReturnType<typeof vi.fn>;
      then: (resolve: (value: typeof result) => unknown) => Promise<unknown>;
    } = {
      eq: vi.fn(),
      in: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      then: (resolve) => Promise.resolve(result).then(resolve),
    };
    thenable.eq.mockReturnValue(thenable);
    thenable.in.mockReturnValue(thenable);
    return thenable;
  };
  const admin = {
    from: vi.fn((table: string) => ({
      delete: vi.fn(() => chain(table, "delete")),
      update: vi.fn(() => chain(table, "update")),
      select: vi.fn(() => chain(table, "select")),
    })),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: { user: { deleted_at: "2026-09-28" } },
          error: null,
        })),
      },
    },
  };
  return { admin, writes };
}

describe("babysitting owner-approved teardown", () => {
  it("fingerprints the executable plan, not only containment format", () => {
    const registry = new IntegrationFixtureRegistry({
      suite: "babysittingCapabilities.integration",
    });
    const plan = samplePlan(sampleSnapshot(registry));
    const fingerprint = fingerprintBabysittingTeardownPlan(plan);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const drifted = samplePlan(sampleSnapshot(new IntegrationFixtureRegistry({ suite: "other" })));
    expect(fingerprintBabysittingTeardownPlan(drifted)).not.toBe(fingerprint);
    const nestedChanged = samplePlan(plan.snapshot, {
      actions: [
        ...(plan.containment.plan.actions as Array<Record<string, unknown>>),
        {
          entityType: "identity",
          id: "outsider",
          actionType: "disable_auth",
          currentState: { banned: false },
          intendedState: { banned: true },
        },
      ],
    });
    expect(fingerprintBabysittingTeardownPlan(nestedChanged)).not.toBe(fingerprint);
  });

  it("refuses execute without approval, with malformed fingerprint, or with a self-bound mismatched plan", () => {
    const registry = new IntegrationFixtureRegistry({
      suite: "babysittingCapabilities.integration",
    });
    const plan = samplePlan(sampleSnapshot(registry));
    const fingerprint = fingerprintBabysittingTeardownPlan(plan);

    expect(() => assertOwnerApprovedTeardown({ currentPlan: plan })).toThrow(
      /requires owner-approved plan fingerprint/i,
    );
    expect(() =>
      assertOwnerApprovedTeardown({
        currentPlan: plan,
        approval: { fingerprint: "not-a-fingerprint", plan },
      }),
    ).toThrow(/malformed/i);
    expect(() =>
      assertOwnerApprovedTeardown({
        currentPlan: plan,
        approval: {
          fingerprint,
          plan: { ...plan, snapshot: { ...plan.snapshot, bookingIds: ["other"] } },
        },
      }),
    ).toThrow(/does not match the bound reviewed plan/i);
  });

  it("rejects nested executable-plan tamper that preserves summary actions and fingerprints", () => {
    const registry = new IntegrationFixtureRegistry({
      suite: "babysittingCapabilities.integration",
    });
    const plan = samplePlan(sampleSnapshot(registry));
    const fingerprint = fingerprintBabysittingTeardownPlan(plan);
    const tampered = structuredClone(plan);
    (tampered.containment.plan.actions as Array<Record<string, unknown>>).push({
      entityType: "identity",
      id: "outsider",
      actionType: "disable_auth",
      currentState: { banned: false },
      intendedState: { banned: true },
    });

    expect(() => fingerprintBabysittingTeardownPlan(tampered)).toThrow(
      /disagree with executable plan actions|does not match the bound containment fingerprint/i,
    );
    expect(() =>
      assertOwnerApprovedTeardown({
        currentPlan: plan,
        approval: { fingerprint, plan: tampered },
      }),
    ).toThrow(
      /disagree with executable plan actions|does not match the bound (reviewed plan|containment fingerprint)/i,
    );
  });

  it("rejects a changed current plan even when the bound approval is internally consistent", () => {
    const registry = new IntegrationFixtureRegistry({
      suite: "babysittingCapabilities.integration",
    });
    const plan = samplePlan(sampleSnapshot(registry));
    const fingerprint = fingerprintBabysittingTeardownPlan(plan);
    const current = samplePlan({
      ...plan.snapshot,
      zoneIds: [...plan.snapshot.zoneIds, "zone-extra"],
    });
    expect(() =>
      assertOwnerApprovedTeardown({
        currentPlan: current,
        approval: { fingerprint, plan },
      }),
    ).toThrow(/drifted from the owner-approved fingerprint/i);
  });

  it("records pending residue truthfully without calling teardown writes", () => {
    const registry = new IntegrationFixtureRegistry({
      suite: "babysittingCapabilities.integration",
    });
    const plan = samplePlan(sampleSnapshot(registry));
    const pending = buildPendingTeardownRecord(plan, { adminEmail: "qa-babysit-a@famio.local" });
    expect(pending.status).toBe("pending_owner_approval");
    expect(pending.residueActive).toBe(true);
    expect(pending.automaticContainmentIsReadOnly).toBe(false);
    expect(pending.writesPerformed).toBe(false);
    expect(pending.fingerprint).toBe(fingerprintBabysittingTeardownPlan(plan));
    expect(pending.resume).toMatch(/Do not rerun the mutating suite/);

    const dir = mkdtempSync(path.join(tmpdir(), "pr67-pending-"));
    try {
      const file = path.join(dir, "pending.json");
      persistPendingTeardown(pending, file);
      const saved = JSON.parse(readFileSync(file, "utf8"));
      expect(saved.fingerprint).toBe(pending.fingerprint);
      expect(saved.residueActive).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("performs zero teardown writes without a valid matching approval", async () => {
    const registry = new IntegrationFixtureRegistry({
      suite: "babysittingCapabilities.integration",
    });
    const plan = samplePlan(sampleSnapshot(registry));
    const { admin, writes } = trackingAdmin();
    const ctx = { registry, admin: admin as never, anonKey: "anon" };

    await expect(
      resumeApprovedBabysittingTeardown(ctx, admin as never, undefined as never),
    ).rejects.toThrow(/requires owner-approved plan fingerprint/i);
    expect(writes).toEqual([]);

    await expect(
      resumeApprovedBabysittingTeardown(ctx, admin as never, {
        fingerprint: "d".repeat(64),
        plan,
      }),
    ).rejects.toThrow(/does not match the bound reviewed plan/i);
    expect(writes).toEqual([]);
  });

  it("operational resume rebuilds the current plan and refuses drifted dry-run data", async () => {
    const registry = new IntegrationFixtureRegistry({
      suite: "babysittingCapabilities.integration",
    });
    const plan = samplePlan(sampleSnapshot(registry));
    const fingerprint = fingerprintBabysittingTeardownPlan(plan);
    const { admin, writes } = trackingAdmin();
    const ctx = { registry, admin: admin as never, anonKey: "anon" };
    dryRunHolder.plan = sampleExecutable({
      actions: [
        {
          entityType: "identity",
          id: "drifted",
          actionType: "disable_auth",
          currentState: { banned: false },
          intendedState: { banned: true },
        },
      ],
    });

    await expect(
      resumeApprovedBabysittingTeardown(ctx, admin as never, { fingerprint, plan }),
    ).rejects.toThrow(/drifted from the owner-approved fingerprint/i);
    expect(writes).toEqual([]);
    dryRunHolder.plan = null;
  });

  it("executes only the approved snapshot targets after a matching owner fingerprint", async () => {
    const registry = new IntegrationFixtureRegistry({
      suite: "babysittingCapabilities.integration",
    });
    const plan = samplePlan(sampleSnapshot(registry));
    const fingerprint = fingerprintBabysittingTeardownPlan(plan);
    const { admin, writes } = trackingAdmin();
    const ctx = { registry, admin: admin as never, anonKey: "anon" };
    dryRunHolder.plan = plan.containment.plan;

    await resumeApprovedBabysittingTeardown(ctx, admin as never, { fingerprint, plan });

    expect(writes.some((row) => row.startsWith("zone_providers.delete"))).toBe(true);
    expect(writes.some((row) => row.startsWith("zone_services.delete"))).toBe(true);
    expect(writes.some((row) => row.startsWith("provider_services.delete"))).toBe(true);
    expect(writes.some((row) => row.startsWith("addresses.delete"))).toBe(true);
    expect(writes.some((row) => row.startsWith("zones.delete"))).toBe(true);
    expect(admin.from.mock.calls.map((call: string[]) => call[0])).not.toContain(
      "unapproved-table",
    );
    dryRunHolder.plan = null;
  });

  it("shared teardown with approval refuses to write when containment fingerprints do not match", async () => {
    const registry = new IntegrationFixtureRegistry({
      suite: "babysittingCapabilities.integration",
    });
    const snapshot = sampleSnapshot(registry);
    const { admin, writes } = trackingAdmin();
    await expect(
      teardownRegisteredFixture(admin as never, registry, snapshot, {
        approval: {
          snapshot,
          containmentPlan: { fingerprint: "c".repeat(64), actions: [] },
          expectedContainmentFingerprint: "e".repeat(64),
        },
      }),
    ).rejects.toThrow(/approval is missing or does not match/i);
    expect(writes).toEqual([]);
  });

  it("shared teardown refuses nested action tamper before link deletes", async () => {
    const registry = new IntegrationFixtureRegistry({
      suite: "babysittingCapabilities.integration",
    });
    const plan = samplePlan(sampleSnapshot(registry));
    const { admin, writes } = trackingAdmin();
    const tampered = structuredClone(plan.containment.plan) as {
      fingerprint: string;
      actions: Array<{
        actionType: string;
        entityType: string;
        id: string;
        currentState?: unknown;
        intendedState?: unknown;
      }>;
      [key: string]: unknown;
    };
    tampered.actions = [
      ...tampered.actions,
      {
        entityType: "identity",
        id: "outsider",
        actionType: "disable_auth",
        currentState: { banned: false },
        intendedState: { banned: true },
      },
    ];

    await expect(
      teardownRegisteredFixture(admin as never, registry, plan.snapshot, {
        approval: {
          snapshot: plan.snapshot,
          containmentPlan: tampered,
          expectedContainmentFingerprint: plan.containment.fingerprint,
        },
      }),
    ).rejects.toThrow(/does not match the bound containment fingerprint/i);
    expect(writes).toEqual([]);
  });

  it("pending error is not a successful cleanup", () => {
    const registry = new IntegrationFixtureRegistry({
      suite: "babysittingCapabilities.integration",
    });
    const pending = buildPendingTeardownRecord(samplePlan(sampleSnapshot(registry)));
    const error = new PendingBabysittingTeardownError(pending);
    expect(error.message).toMatch(/fixtures remain active/i);
    expect(error.pending.writesPerformed).toBe(false);
    expect(error.pending.residueActive).toBe(true);
    expect(BABYSITTING_TEARDOWN_PLAN_VERSION).toBe("pr67-babysitting-teardown-v3");
  });
});
