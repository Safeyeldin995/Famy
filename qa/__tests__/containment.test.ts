import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseContainmentArgs, CONTAINMENT_CONFIRM_VALUE } from "../containment-args.mjs";
import {
  planBookingContainmentAction,
  QA_CONTAINMENT_REASON_CODE,
  CONTAINMENT_PLAN_VERSION,
} from "../containment-booking-lifecycle.mjs";
import {
  identityNeedsContainment,
  isIdentityAlreadyContained,
  planIdentityContainmentActions,
} from "../containment-identity.mjs";
import {
  buildContainmentPlanFromSnapshot,
  planProviderContainmentAction,
  planServiceContainmentAction,
} from "../containment-planner.mjs";
import { fingerprintContainmentPlan, INVALIDATED_CONTAINMENT_FINGERPRINT_V1, INVALIDATED_CONTAINMENT_FINGERPRINT_V2 } from "../containment-fingerprint.mjs";
import { BOOKING_CALLER_CLASS, CALLER_AUTH_MODE } from "../containment-booking-caller.mjs";
import { assertContainmentPlanApproved } from "../containment-core.mjs";
import { buildIntegrationContainmentPlan } from "../containment-integration.mjs";
import { runPreflightChecks } from "../env-guard.mjs";
import { KNOWN_PRODUCTION_PROJECT_REF, KNOWN_QA_PROJECT_REF } from "../qa-identity.mjs";

const REPO_ROOT = process.cwd();
const FAKE_FINGERPRINT = "b".repeat(64);

function containmentModuleUrl() {
  return pathToFileURL(path.join(REPO_ROOT, "qa/containment.mjs")).href;
}

describe("containment identity selection", () => {
  it("excludes already-contained identity", () => {
    expect(isIdentityAlreadyContained({ authBanned: true, profileSuspended: true, hasAdminRole: false })).toBe(true);
    expect(identityNeedsContainment({
      userId: "user-contained",
      email: "qa-test@famio.local",
      fullName: "QA_test",
      authBanned: true,
      profileSuspended: true,
      hasAdminRole: false,
    })).toBe(false);
  });

  it("plans unsuspended identity", () => {
    expect(identityNeedsContainment({
      userId: "user-unsuspended",
      email: "qa-test@famio.local",
      fullName: "QA_test",
      authBanned: true,
      profileSuspended: false,
      hasAdminRole: false,
    })).toBe(true);
    const plan = planIdentityContainmentActions({
      userId: "user-unsuspended",
      authBanned: true,
      profileSuspended: false,
      hasAdminRole: false,
    });
    expect(plan.actions.some((row) => row.actionType === "suspend_profile")).toBe(true);
  });

  it("plans unbanned identity", () => {
    expect(identityNeedsContainment({
      userId: "user-unbanned",
      email: "qa-test@famio.local",
      fullName: "QA_test",
      authBanned: false,
      profileSuspended: true,
      hasAdminRole: false,
    })).toBe(true);
    const plan = planIdentityContainmentActions({
      userId: "user-unbanned",
      authBanned: false,
      profileSuspended: true,
      hasAdminRole: false,
    });
    expect(plan.actions.some((row) => row.actionType === "ban_auth")).toBe(true);
  });

  it("plans admin role removal", () => {
    const plan = planIdentityContainmentActions({
      userId: "user-admin",
      authBanned: true,
      profileSuspended: true,
      hasAdminRole: true,
    });
    expect(plan.actions.some((row) => row.actionType === "remove_admin_role")).toBe(true);
  });
});

describe("containment resource planning", () => {
  it("never plans seeded services", () => {
    const action = planServiceContainmentAction({ id: "seed-1", name_en: "Deep Cleaning", is_active: true });
    expect(action.actionType).toBe("skip");
    expect(action.reason).toBe("protected-seeded-service");
  });

  it("plans active QA service deactivation", () => {
    const action = planServiceContainmentAction({ id: "svc-1", name_en: "QA Booking Service 123", is_active: true });
    expect(action.actionType).toBe("deactivate_service");
    expect(action.to).toBe(false);
  });

  it("plans retained provider inactivation", () => {
    const action = planProviderContainmentAction({ id: "prov-1", is_active: true, vacation_mode: false });
    expect(action.actionType).toBe("disable_provider");
  });
});

describe("booking lifecycle contract", () => {
  it("uses sanctioned cancel_booking path for pending QA bookings", () => {
    const action = planBookingContainmentAction({
      id: "booking-1",
      status: "pending",
      notes: "QA booking integration",
      hasCancellationRecord: false,
      isQaTagged: true,
    });
    expect(action.actionType).toBe("cancel_booking");
    expect(action.rpc).toBe("cancel_booking");
    expect(action.args?.p_reason_code).toBe(QA_CONTAINMENT_REASON_CODE);
    expect(action.resultingStatus).toBe("cancelled");
  });

  it("does not create duplicate cancellation when record exists", () => {
    const action = planBookingContainmentAction({
      id: "booking-1",
      status: "pending",
      notes: "QA booking integration",
      hasCancellationRecord: true,
      isQaTagged: true,
    });
    expect(action.actionType).toBe("noop");
    expect(action.reason).toBe("cancellation-record-exists");
  });

  it("terminal booking containment is idempotent", () => {
    const action = planBookingContainmentAction({
      id: "booking-1",
      status: "cancelled",
      notes: "QA booking integration",
      hasCancellationRecord: true,
      isQaTagged: true,
    });
    expect(action.actionType).toBe("noop");
    expect(action.reason).toBe("already-terminal");
  });

  it("does not plan deletes against immutable history tables", () => {
    const plan = buildContainmentPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      bookings: [{
        id: "booking-1",
        status: "pending",
        notes: "QA booking integration",
        hasCancellationRecord: false,
      }],
    });
    expect(plan.actions.every((row) => !row.actionType.includes("delete"))).toBe(true);
  });
});

describe("containment fingerprint", () => {
  it("changes when state or action changes", () => {
    const base = [{
      entityType: "service",
      id: "svc-1",
      actionType: "deactivate_service",
      currentState: true,
      intendedState: false,
    }];
    const fp1 = fingerprintContainmentPlan(base, KNOWN_QA_PROJECT_REF, {
      bookingCallerUserId: "11111111-1111-4111-8111-111111111111",
      bookingCallerClass: BOOKING_CALLER_CLASS,
      callerAuthMode: CALLER_AUTH_MODE,
      cancellationReasonId: "reason-1",
      bookings: [],
    });
    const fp2 = fingerprintContainmentPlan([{
      ...base[0],
      currentState: false,
      intendedState: false,
    }], KNOWN_QA_PROJECT_REF, {
      bookingCallerUserId: "11111111-1111-4111-8111-111111111111",
      bookingCallerClass: BOOKING_CALLER_CLASS,
      callerAuthMode: CALLER_AUTH_MODE,
      cancellationReasonId: "reason-1",
      bookings: [],
    });
    expect(fp1).not.toBe(fp2);
    expect(fp1).not.toBe(INVALIDATED_CONTAINMENT_FINGERPRINT_V1);
    expect(fp1).not.toBe(INVALIDATED_CONTAINMENT_FINGERPRINT_V2);
  });

  it("rejects invalidated v1 and v2 fingerprints at execute approval", () => {
    const plan = {
      blocked: false,
      version: CONTAINMENT_PLAN_VERSION,
      fingerprint: "fresh-fingerprint",
    };
    expect(() => assertContainmentPlanApproved(plan as never, INVALIDATED_CONTAINMENT_FINGERPRINT_V1))
      .toThrow(/invalidated/i);
    expect(() => assertContainmentPlanApproved(plan as never, INVALIDATED_CONTAINMENT_FINGERPRINT_V2))
      .toThrow(/invalidated/i);
  });

  it("is ordering-stable", () => {
    const rows = [
      { entityType: "service", id: "b", actionType: "deactivate_service", currentState: true, intendedState: false },
      { entityType: "identity", id: "a", actionType: "ban_auth", currentState: false, intendedState: true },
    ];
    const metadata = {
      bookingCallerUserId: null,
      bookingCallerClass: null,
      cancellationReasonId: null,
      bookings: [],
    };
    expect(fingerprintContainmentPlan(rows, KNOWN_QA_PROJECT_REF, metadata))
      .toBe(fingerprintContainmentPlan([...rows].reverse(), KNOWN_QA_PROJECT_REF, metadata));
  });
});

describe("production guard", () => {
  it("rejects production ref", () => {
    expect(() => runPreflightChecks({
      FAMY_ENV: "qa",
      FAMY_QA_SUPABASE_PROJECT_REF: KNOWN_QA_PROJECT_REF,
      FAMY_PRODUCTION_SUPABASE_PROJECT_REF: KNOWN_PRODUCTION_PROJECT_REF,
      QA_SUPABASE_URL: `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`,
      QA_SUPABASE_SECRET_KEY: "test-secret-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-secret-key",
      QA_E2E_APP_ORIGIN: "http://127.0.0.1:4173",
    })).toThrow(/Production/);
  });
});

describe("integration containment scope", () => {
  it("plans only snapshot-scoped newly-created residue", async () => {
    const priorUrl = process.env.QA_SUPABASE_URL;
    process.env.QA_SUPABASE_URL = `https://${KNOWN_QA_PROJECT_REF}.supabase.co`;
    const containedUserId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const newUserId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    try {
      const admin = {
        auth: {
          admin: {
            getUserById: vi.fn(async (userId) => ({
              data: {
                user: userId === containedUserId
                  ? { id: userId, email: "qa-contained@famio.local", banned_until: new Date(Date.now() + 86400000).toISOString() }
                  : { id: userId, email: "qa-new@famio.local", banned_until: null },
              },
              error: null,
            })),
          },
        },
        from: vi.fn((table) => ({
          select: vi.fn(() => ({
            eq: vi.fn((_column, value) => {
              if (table === "profiles") {
                return {
                  maybeSingle: vi.fn(async () => ({
                    data: {
                      full_name: value === containedUserId ? "QA_test" : "QA_new",
                      is_suspended: value === containedUserId,
                    },
                    error: null,
                  })),
                };
              }
              if (table === "user_roles") {
                return Promise.resolve({ data: [], error: null });
              }
              return Promise.resolve({ data: null, error: null });
            }),
            in: vi.fn(async () => ({ data: [], error: null })),
          })),
        })),
      };

      const plan = await buildIntegrationContainmentPlan(admin as never, {
        userIds: [containedUserId, newUserId],
        bookingIds: [],
        serviceIds: [],
        providerIds: [],
      });

      expect(plan.excluded).toHaveLength(1);
      expect(plan.excluded[0]?.reason).toBe("already-contained");
      expect(plan.actions.some((row) => row.actionType === "ban_auth")).toBe(true);
      expect(plan.actions.every((row) => row.id === newUserId || row.entityType !== "identity")).toBe(true);
      expect(plan.actions.some((row) => row.actionType === "delete")).toBe(false);
    } finally {
      if (priorUrl === undefined) {
        delete process.env.QA_SUPABASE_URL;
      } else {
        process.env.QA_SUPABASE_URL = priorUrl;
      }
    }
  });
});

describe("containment CLI args", () => {
  it("defaults to dry-run", () => {
    expect(parseContainmentArgs([]).mode).toBe("dry-run");
  });

  it("requires distinct confirmation phrase", () => {
    const parsed = parseContainmentArgs([
      "--execute",
      `--confirm=${CONTAINMENT_CONFIRM_VALUE}`,
      `--plan-fingerprint=${FAKE_FINGERPRINT}`,
    ]);
    expect(parsed.mode).toBe("execute");
  });
});

describe("native import safety", () => {
  it("importing containment.mjs causes zero side effects", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-containment-import-"));
    const script = `
      process.chdir(${JSON.stringify(tmpDir)});
      process.argv = ["node", "ignored-entry.mjs", "--execute", "--confirm=${CONTAINMENT_CONFIRM_VALUE}", "--plan-fingerprint=${FAKE_FINGERPRINT}"];
      await import(${JSON.stringify(containmentModuleUrl())});
      console.log("IMPORT_OK");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: REPO_ROOT,
      env: { ...process.env, FAMY_ENV: "qa" },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IMPORT_OK");
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });
});

describe("35 contained users exclusion proof", () => {
  it("excludes banned+suspended non-admin identities from plan actions", () => {
    const contained = Array.from({ length: 35 }, (_, index) => ({
      userId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      email: `qa-contained-${index}@famio.local`,
      fullName: "QA_test",
      authBanned: true,
      profileSuspended: true,
      hasAdminRole: false,
      inRegistry: false,
    }));
    const uncontained = [
      {
        userId: "11111111-1111-4111-8111-111111111111",
        email: "qa-onboard-admin@famio.local",
        fullName: "qa-onboard-admin@famio.local",
        authBanned: false,
        profileSuspended: false,
        hasAdminRole: true,
        inRegistry: true,
      },
    ];
    const plan = buildContainmentPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      identities: [...contained, ...uncontained],
      standaloneBookingCaller: false,
    });
    expect(plan.excluded).toHaveLength(35);
    expect(plan.actions.filter((row) => row.entityType === "identity")).toHaveLength(3);
    expect(plan.actions.every((row) => row.id === uncontained[0].userId)).toBe(true);
  });
});
