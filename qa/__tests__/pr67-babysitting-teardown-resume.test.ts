import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  BABYSITTING_TEARDOWN_PLAN_VERSION,
  buildBabysittingTeardownPlan,
  buildPendingTeardownRecord,
  fingerprintBabysittingTeardownPlan,
  parseBabysittingTeardownResumeArgs,
  parsePendingTeardown,
  persistPendingTeardown,
  withComputedContainmentFingerprint,
  CONTAINMENT_CONFIRM_VALUE,
} from "../babysitting-teardown-plan.mjs";
import {
  executeApprovedBabysittingSnapshotTeardown,
  resumeBabysittingTeardownFromPending,
} from "../pr67-babysitting-teardown-resume.mjs";

const currentContainmentHolder = { plan: null };
const callerAuthHolder: {
  result: { ok: boolean; rpcClient?: { rpc: ReturnType<typeof vi.fn> }; reason?: string } | null;
} = { result: null };

vi.mock("../containment-booking-caller.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    authenticateBookingCaller: vi.fn(async () => {
      if (!callerAuthHolder.result) {
        return { ok: false, reason: "caller-authentication-failed" };
      }
      return callerAuthHolder.result;
    }),
  };
});

vi.mock("../containment-integration.mjs", () => ({
  containIntegrationFixtureResidue: vi.fn(async (_admin, _snapshot, options) => {
    const cancels = (options?.approvedPlan?.actions ?? []).filter(
      (row: { actionType: string }) => row.actionType === "cancel_booking",
    );
    for (const action of cancels) {
      if (!options?.bookingRpcClient?.rpc) {
        throw new Error("missing resolved booking client");
      }
      await options.bookingRpcClient.rpc("cancel_booking", { p_booking_id: action.id });
    }
    return {
      plan: options?.approvedPlan ?? { fingerprint: "c".repeat(64), actions: [] },
      execution: {
        results: [
          { ok: true, maskedId: "qa-u…ser", entityType: "identity", actionType: "disable_auth" },
        ],
      },
    };
  }),
  buildBabysittingFixtureContainmentPlan: vi.fn(async () => {
    if (!currentContainmentHolder.plan) {
      throw new Error("buildBabysittingFixtureContainmentPlan must be configured for this test");
    }
    return currentContainmentHolder.plan;
  }),
  buildIntegrationContainmentPlan: vi.fn(async () => {
    throw new Error(
      "shared buildIntegrationContainmentPlan must not be used by babysitting resume",
    );
  }),
}));

vi.mock("../registry.mjs", () => ({
  recordRecoveryFailure: vi.fn(),
}));

function sampleSnapshot() {
  return {
    runId: "run-1",
    suite: "babysittingCapabilities.integration",
    userIds: ["user-1"],
    adminUserIds: ["user-1"],
    roleAssignments: [],
    addressIds: ["addr-1"],
    bookingIds: ["book-1"],
    serviceIds: ["svc-1"],
    zoneIds: ["zone-1"],
    providerIds: ["prov-1"],
    zoneProviderLinks: [{ zoneId: "zone-1", providerId: "prov-1" }],
    zoneServiceLinks: [{ zoneId: "zone-1", serviceId: "svc-1" }],
    providerServiceLinks: [{ providerId: "prov-1", serviceId: "svc-1" }],
    paymentIds: [],
    failedCleanup: [],
  };
}

function sampleExecutable(extras = {}) {
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
    ],
    ...extras,
  });
}

function samplePending() {
  const plan = buildBabysittingTeardownPlan(sampleSnapshot(), sampleExecutable());
  return buildPendingTeardownRecord(plan);
}

function trackingAdmin() {
  const writes = [];
  const chain = (table, op) => {
    writes.push(`${table}.${op}`);
    const result = { error: null, data: [] };
    const thenable = {
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
    from: vi.fn((table) => ({
      delete: vi.fn(() => chain(table, "delete")),
      update: vi.fn(() => chain(table, "update")),
      select: vi.fn(() => chain(table, "select")),
    })),
  };
  return { admin, writes };
}

describe("PR67 babysitting teardown resume CLI", () => {
  it("rejects execute without owner fingerprint and does not treat the pending hash as approval", () => {
    expect(
      parseBabysittingTeardownResumeArgs(
        ["--execute", `--confirm=${CONTAINMENT_CONFIRM_VALUE}`],
        {},
      ),
    ).toMatchObject({
      mode: "rejected",
      error: expect.stringMatching(/not auto-approved|requires --plan-fingerprint/i),
    });
    expect(
      parseBabysittingTeardownResumeArgs([], { PR67_TEARDOWN_PLAN_FINGERPRINT: "zz" }),
    ).toMatchObject({
      mode: "rejected",
    });
    expect(parseBabysittingTeardownResumeArgs(["--force"])).toMatchObject({ mode: "rejected" });
  });

  it("accepts verify without fingerprint and execute only with matching hex + confirm", () => {
    const hex = "a".repeat(64);
    expect(parseBabysittingTeardownResumeArgs([])).toMatchObject({
      mode: "verify",
      planFingerprint: undefined,
    });
    expect(parseBabysittingTeardownResumeArgs([`--plan-fingerprint=${hex}`], {})).toMatchObject({
      mode: "verify",
      planFingerprint: hex,
    });
    expect(
      parseBabysittingTeardownResumeArgs(
        ["--execute", `--confirm=${CONTAINMENT_CONFIRM_VALUE}`, `--plan-fingerprint=${hex}`],
        {},
      ),
    ).toMatchObject({ mode: "execute", planFingerprint: hex });
    expect(
      parseBabysittingTeardownResumeArgs(["--execute", `--confirm=${CONTAINMENT_CONFIRM_VALUE}`], {
        PR67_TEARDOWN_PLAN_FINGERPRINT: hex,
      }),
    ).toMatchObject({ mode: "execute", planFingerprint: hex });
  });

  it("parsePendingTeardown refuses concealed residue or self-inconsistent nested plans", () => {
    const pending = samplePending();
    expect(() => parsePendingTeardown({ ...pending, residueActive: false })).toThrow(
      /conceals active residue/i,
    );
    expect(() =>
      parsePendingTeardown({ ...pending, automaticContainmentIsReadOnly: true }),
    ).toThrow(/read-only/i);
    expect(() => parsePendingTeardown({ ...pending, writesPerformed: true })).toThrow(
      /writes already performed/i,
    );

    const tampered = structuredClone(pending);
    tampered.plan.containment.plan.actions.push({
      entityType: "identity",
      id: "outsider",
      actionType: "disable_auth",
      currentState: { banned: false },
      intendedState: { banned: true },
    });
    expect(() => parsePendingTeardown(tampered)).toThrow(
      /disagree with executable plan actions|does not match the bound/i,
    );
  });

  it("resume execute performs zero writes without valid matching approval or on nested tamper", async () => {
    const pending = samplePending();
    const { admin, writes } = trackingAdmin();
    currentContainmentHolder.plan = pending.plan.containment.plan;

    await expect(
      resumeBabysittingTeardownFromPending({
        mode: "execute",
        pending,
        ownerFingerprint: "",
        admin,
      }),
    ).rejects.toThrow(/requires owner-approved plan fingerprint/i);
    expect(writes).toEqual([]);

    await expect(
      resumeBabysittingTeardownFromPending({
        mode: "execute",
        pending,
        ownerFingerprint: "d".repeat(64),
        admin,
      }),
    ).rejects.toThrow(/does not match the bound reviewed plan/i);
    expect(writes).toEqual([]);

    currentContainmentHolder.plan = sampleExecutable({
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
      resumeBabysittingTeardownFromPending({
        mode: "execute",
        pending,
        ownerFingerprint: pending.fingerprint,
        admin,
      }),
    ).rejects.toThrow(/drifted from the owner-approved fingerprint/i);
    expect(writes).toEqual([]);

    const tamperedPending = structuredClone(pending);
    tamperedPending.plan.containment.plan.actions.push({
      entityType: "identity",
      id: "outsider",
      actionType: "disable_auth",
      currentState: { banned: false },
      intendedState: { banned: true },
    });
    currentContainmentHolder.plan = tamperedPending.plan.containment.plan;
    await expect(
      resumeBabysittingTeardownFromPending({
        mode: "execute",
        pending: tamperedPending,
        ownerFingerprint: pending.fingerprint,
        admin,
      }),
    ).rejects.toThrow(/disagree with executable plan actions|does not match the bound/i);
    expect(writes).toEqual([]);
    currentContainmentHolder.plan = null;
  });

  it("CLI execute helper refuses nested tamper before any snapshot write", async () => {
    const pending = samplePending();
    const { admin, writes } = trackingAdmin();
    const tampered = structuredClone(pending.plan.containment.plan);
    tampered.actions.push({
      entityType: "identity",
      id: "outsider",
      actionType: "disable_auth",
      currentState: { banned: false },
      intendedState: { banned: true },
    });
    await expect(
      executeApprovedBabysittingSnapshotTeardown(
        admin,
        pending.plan.snapshot,
        tampered,
        pending.plan.containment.fingerprint,
        admin,
      ),
    ).rejects.toThrow(/does not match the bound containment fingerprint/i);
    expect(writes).toEqual([]);
  });

  it("approved matching resume execute writes only snapshot targets", async () => {
    const pending = samplePending();
    const { admin, writes } = trackingAdmin();
    currentContainmentHolder.plan = pending.plan.containment.plan;
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    callerAuthHolder.result = { ok: true, rpcClient: { rpc } };
    const result = await resumeBabysittingTeardownFromPending({
      mode: "execute",
      pending,
      ownerFingerprint: pending.fingerprint,
      admin,
    });
    expect(result.writesPerformed).toBe(true);
    expect(result.residueActive).toBe(true);
    expect(result.residueVerified).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      "cancel_booking",
      expect.objectContaining({ p_booking_id: "book-1" }),
    );
    expect(writes.some((row) => row.startsWith("zone_providers.delete"))).toBe(true);
    expect(writes.some((row) => row.startsWith("zone_services.delete"))).toBe(true);
    expect(writes.some((row) => row.startsWith("provider_services.delete"))).toBe(true);
    expect(writes.some((row) => row.startsWith("addresses.delete"))).toBe(true);
    expect(writes.some((row) => row.startsWith("zones.delete"))).toBe(true);
    expect(admin.from.mock.calls.map((call) => call[0])).not.toContain("unapproved-table");
    callerAuthHolder.result = null;
  });

  it("verify mode rebuilds current plan and performs zero writes", async () => {
    const pending = samplePending();
    const { admin, writes } = trackingAdmin();
    currentContainmentHolder.plan = pending.plan.containment.plan;
    const result = await resumeBabysittingTeardownFromPending({
      mode: "verify",
      pending,
      ownerFingerprint: pending.fingerprint,
      admin,
    });
    expect(result.mode).toBe("verify");
    expect(result.writesPerformed).toBe(false);
    expect(result.residueActive).toBe(true);
    expect(writes).toEqual([]);
  });

  it("exported main fails closed before network on missing QA env", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pr67-resume-main-"));
    const pending = samplePending();
    const file = path.join(dir, "pending.json");
    persistPendingTeardown(pending, file);
    const script = `
      process.chdir(${JSON.stringify(dir)});
      const { main } = await import(${JSON.stringify(pathToFileURL(path.join(process.cwd(), "qa/pr67-babysitting-teardown-resume.mjs")).href)});
      const code = await main([
        "--execute",
        "--confirm=${CONTAINMENT_CONFIRM_VALUE}",
        "--pending-file=${file}",
        "--plan-fingerprint=${pending.fingerprint}",
      ]);
      console.log("EXIT:" + code);
    `;
    const env = { ...process.env, FAMY_ENV: "qa" };
    for (const key of Object.keys(env)) {
      if (key.startsWith("QA_SUPABASE_") || key.startsWith("SUPABASE_")) delete env[key];
    }
    delete env.VITEST;
    delete env.VITEST_WORKER_ID;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      env,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("EXIT:1");
    rmSync(dir, { recursive: true, force: true });
  });

  it("importing the resume CLI performs zero actions", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "pr67-resume-import-"));
    const script = `
      process.chdir(${JSON.stringify(tmpDir)});
      process.argv = ["node", "ignored-entry.mjs", "--execute", "--confirm=${CONTAINMENT_CONFIRM_VALUE}", "--plan-fingerprint=${"a".repeat(64)}"];
      await import(${JSON.stringify(pathToFileURL(path.join(process.cwd(), "qa/pr67-babysitting-teardown-resume.mjs")).href)});
      console.log("IMPORT_OK");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, FAMY_ENV: "qa" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IMPORT_OK");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("plan version is the executable v3 contract", () => {
    expect(BABYSITTING_TEARDOWN_PLAN_VERSION).toBe("pr67-babysitting-teardown-v3");
    const pending = samplePending();
    expect(fingerprintBabysittingTeardownPlan(pending.plan)).toBe(pending.fingerprint);
  });
});
