import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BOOKING_CALLER_CLASS,
  BOOKING_CALLER_SELECTION_POLICY,
  CALLER_AUTH_MODE,
} from "../containment-booking-caller.mjs";
import {
  buildBabysittingFixtureContainmentPlan,
  buildIntegrationContainmentPlan,
} from "../containment-integration.mjs";
import {
  assertOwnerApprovedTeardown,
  buildBabysittingTeardownPlan,
  buildPendingTeardownRecord,
  loadPendingTeardown,
  persistPendingTeardown,
} from "../babysitting-teardown-plan.mjs";
import { resumeBabysittingTeardownFromPending } from "../pr67-babysitting-teardown-resume.mjs";
import { registerUserEntry } from "../registry.mjs";
import { KNOWN_QA_PROJECT_REF } from "../qa-identity.mjs";
import { useIsolatedRegistry } from "./registry-test-harness.ts";
import { useIsolatedQaEnv } from "./qa-env-test-harness.ts";

const CALLER_ID = "aaaa1111-1111-4111-8111-111111111111";
const OTHER_ADMIN_ID = "bbbb1111-1111-4111-8111-111111111111";
const BOOKING_ID = "book-pending-1";
const SERVICE_ID = "svc-babysit-1";
const PROVIDER_ID = "prov-babysit-1";
const REASON_ID = "reason-admin-other";
const CALLER_EMAIL = "qa-babysit-a@famio.local";
const OTHER_EMAIL = "qa-babysit-b@famio.local";

useIsolatedRegistry();
useIsolatedQaEnv();

function fixtureSnapshot() {
  return {
    runId: "run-babysit-caller",
    suite: "babysittingCapabilities.integration",
    userIds: [CALLER_ID, OTHER_ADMIN_ID],
    adminUserIds: [CALLER_ID, OTHER_ADMIN_ID],
    roleAssignments: [],
    addressIds: ["addr-1"],
    bookingIds: [BOOKING_ID],
    serviceIds: [SERVICE_ID],
    zoneIds: ["zone-1"],
    providerIds: [PROVIDER_ID],
    zoneProviderLinks: [{ zoneId: "zone-1", providerId: PROVIDER_ID }],
    zoneServiceLinks: [{ zoneId: "zone-1", serviceId: SERVICE_ID }],
    providerServiceLinks: [{ providerId: PROVIDER_ID, serviceId: SERVICE_ID }],
    paymentIds: [],
    failedCleanup: [],
  };
}

function containmentSnapshot() {
  const snapshot = fixtureSnapshot();
  return {
    userIds: snapshot.userIds,
    adminUserIds: snapshot.adminUserIds,
    serviceIds: snapshot.serviceIds,
    providerIds: snapshot.providerIds,
    bookingIds: snapshot.bookingIds,
  };
}

type FixtureState = {
  users: Map<string, { email: string; banned_until: string | null; ban_duration: string | null }>;
  profiles: Map<string, { full_name: string; is_suspended: boolean }>;
  roles: Map<string, string[]>;
  services: Array<{ id: string; name_en: string; is_active: boolean }>;
  providers: Array<{
    id: string;
    is_active: boolean;
    vacation_mode: boolean;
    onboarding_status: string;
    is_verified: boolean;
  }>;
  bookings: Array<{ id: string; status: string; notes: string | null }>;
  cancellations: Set<string>;
  reasonId: string;
  mutations: string[];
};

function createState(options: { bookingNotes?: string } = {}): FixtureState {
  return {
    users: new Map([
      [CALLER_ID, { email: CALLER_EMAIL, banned_until: null, ban_duration: null }],
      [OTHER_ADMIN_ID, { email: OTHER_EMAIL, banned_until: null, ban_duration: null }],
    ]),
    profiles: new Map([
      [CALLER_ID, { full_name: "QA Babysit Admin", is_suspended: false }],
      [OTHER_ADMIN_ID, { full_name: "QA Babysit Other", is_suspended: false }],
    ]),
    roles: new Map([
      [CALLER_ID, ["admin"]],
      [OTHER_ADMIN_ID, ["admin"]],
    ]),
    services: [{ id: SERVICE_ID, name_en: "QA_ babysitting", is_active: true }],
    providers: [
      {
        id: PROVIDER_ID,
        is_active: true,
        vacation_mode: false,
        onboarding_status: "APPROVED",
        is_verified: true,
      },
    ],
    bookings: [
      {
        id: BOOKING_ID,
        status: "pending",
        notes: options.bookingNotes ?? "existing babysitting booking",
      },
    ],
    cancellations: new Set(),
    reasonId: REASON_ID,
    mutations: [],
  };
}

function createAdmin(state: FixtureState) {
  const recordMutation = (label: string) => {
    state.mutations.push(label);
  };

  const resolveSelect = (table: string, filters: Record<string, unknown>, single: boolean) => {
    if (table === "profiles") {
      const id = String(filters.id ?? "");
      const row = state.profiles.get(id) ?? null;
      return single ? { data: row, error: null } : { data: row ? [row] : [], error: null };
    }
    if (table === "user_roles") {
      const userId = String(filters.user_id ?? "");
      let roles = (state.roles.get(userId) ?? []).map((role) => ({ role }));
      if (filters.role) {
        roles = roles.filter((row) => row.role === filters.role);
      }
      return { data: roles, error: null };
    }
    if (table === "services") {
      const ids = new Set(
        Array.isArray(filters.id) ? filters.id.map(String) : filters.id ? [String(filters.id)] : [],
      );
      const rows = state.services.filter((row) => (ids.size ? ids.has(row.id) : true));
      const row = rows.find((item) => item.id === filters.id) ?? rows[0] ?? null;
      return single ? { data: row, error: null } : { data: rows, error: null };
    }
    if (table === "providers") {
      const ids = new Set(
        Array.isArray(filters.id) ? filters.id.map(String) : filters.id ? [String(filters.id)] : [],
      );
      const rows = state.providers.filter((row) => (ids.size ? ids.has(row.id) : true));
      const row = rows.find((item) => item.id === String(filters.id ?? "")) ?? rows[0] ?? null;
      return single ? { data: row, error: null } : { data: rows, error: null };
    }
    if (table === "bookings") {
      const ids = new Set(
        Array.isArray(filters.id) ? filters.id.map(String) : filters.id ? [String(filters.id)] : [],
      );
      const rows = state.bookings.filter((row) => (ids.size ? ids.has(row.id) : true));
      const row = rows.find((item) => item.id === String(filters.id ?? "")) ?? rows[0] ?? null;
      return single
        ? { data: row ? { status: row.status, notes: row.notes, id: row.id } : null, error: null }
        : { data: rows, error: null };
    }
    if (table === "booking_cancellations") {
      const ids = new Set(
        Array.isArray(filters.booking_id)
          ? filters.booking_id.map(String)
          : filters.booking_id
            ? [String(filters.booking_id)]
            : [],
      );
      const rows = [...state.cancellations]
        .filter((id) => (ids.size ? ids.has(id) : true))
        .map((booking_id) => ({ booking_id }));
      const row = rows.find((item) => item.booking_id === String(filters.booking_id ?? "")) ?? null;
      return single ? { data: row, error: null } : { data: rows, error: null };
    }
    if (table === "cancellation_reasons") {
      const match =
        filters.code === "admin_other" &&
        (filters.is_active === undefined || filters.is_active === true);
      return single
        ? { data: match ? { id: state.reasonId } : null, error: null }
        : { data: match ? [{ id: state.reasonId }] : [], error: null };
    }
    return single ? { data: null, error: null } : { data: [], error: null };
  };

  const applyMutation = (
    table: string,
    op: string,
    filters: Record<string, unknown>,
    patch: Record<string, unknown> | null,
  ) => {
    recordMutation(`${table}.${op}`);
    if (table === "profiles" && op === "update" && patch?.is_suspended === true) {
      const row = state.profiles.get(String(filters.id ?? ""));
      if (row) row.is_suspended = true;
    }
    if (table === "user_roles" && op === "delete" && filters.role === "admin") {
      state.roles.set(String(filters.user_id ?? ""), []);
    }
    if (table === "services" && op === "update") {
      for (const row of state.services) {
        if (!filters.id || row.id === filters.id) {
          Object.assign(row, patch);
        }
      }
    }
    if (table === "providers" && op === "update") {
      for (const row of state.providers) {
        if (!filters.id || row.id === filters.id) {
          Object.assign(row, patch);
        }
      }
    }
    return { data: null, error: null };
  };

  const query = (table: string) => {
    const ctx: {
      op: string;
      filters: Record<string, unknown>;
      patch: Record<string, unknown> | null;
    } = { op: "select", filters: {}, patch: null };
    const builder: {
      select: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      in: ReturnType<typeof vi.fn>;
      maybeSingle: ReturnType<typeof vi.fn>;
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise<unknown>;
    } = {
      select: vi.fn(() => {
        ctx.op = "select";
        return builder;
      }),
      update: vi.fn((patch: Record<string, unknown>) => {
        ctx.op = "update";
        ctx.patch = patch;
        return builder;
      }),
      delete: vi.fn(() => {
        ctx.op = "delete";
        return builder;
      }),
      eq: vi.fn((column: string, value: unknown) => {
        ctx.filters[column] = value;
        return builder;
      }),
      in: vi.fn((column: string, values: unknown[]) => {
        ctx.filters[column] = values;
        return builder;
      }),
      maybeSingle: vi.fn(async () => {
        if (ctx.op === "select") return resolveSelect(table, ctx.filters, true);
        return applyMutation(table, ctx.op, ctx.filters, ctx.patch);
      }),
      then: (resolve, reject) => {
        const result =
          ctx.op === "select"
            ? resolveSelect(table, ctx.filters, false)
            : applyMutation(table, ctx.op, ctx.filters, ctx.patch);
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  };

  const admin = {
    auth: {
      admin: {
        getUserById: vi.fn(async (userId: string) => {
          const user = state.users.get(userId);
          return {
            data: user
              ? {
                  user: {
                    id: userId,
                    email: user.email,
                    banned_until: user.banned_until,
                    ban_duration: user.ban_duration,
                  },
                }
              : { user: null },
            error: user ? null : { message: "not-found" },
          };
        }),
        updateUserById: vi.fn(async (userId: string, patch: { ban_duration?: string }) => {
          recordMutation("auth.updateUserById");
          const user = state.users.get(userId);
          if (user && patch?.ban_duration) {
            user.ban_duration = patch.ban_duration;
          }
          return { error: null };
        }),
        signOut: vi.fn(async () => ({ error: null })),
      },
    },
    from: vi.fn((table: string) => query(table)),
  };
  return admin;
}

function authDeps(
  state: FixtureState,
  options: { generateError?: boolean; verifyError?: boolean; verifyUserId?: string } = {},
) {
  const rpc = vi.fn(async (fn: string, args: { p_booking_id?: string }) => {
    if (fn === "cancel_booking") {
      const id = String(args?.p_booking_id ?? "");
      const booking = state.bookings.find((row) => row.id === id);
      if (booking) booking.status = "cancelled";
      state.cancellations.add(id);
      state.mutations.push(`rpc.cancel_booking:${id}`);
    }
    return { data: null, error: null };
  });
  return {
    supabaseUrl: `https://${KNOWN_QA_PROJECT_REF}.supabase.co`,
    publishableKey: "sb_publishable_test_placeholder",
    generateLink: vi.fn(async () => ({
      data: options.generateError ? {} : { properties: { hashed_token: "hashed-token" } },
      error: options.generateError ? { message: "generate failed" } : null,
    })),
    verifyOtp: vi.fn(async () => ({
      data: options.verifyError
        ? null
        : {
            user: { id: options.verifyUserId ?? CALLER_ID },
            session: { access_token: "jwt-token" },
          },
      error: options.verifyError ? { message: "verify failed" } : null,
    })),
    createPublishableClient: () => ({
      auth: { verifyOtp: vi.fn() },
      rpc,
    }),
    rpc,
  };
}

function registerRunOwnedAdmins() {
  registerUserEntry({
    userId: CALLER_ID,
    email: CALLER_EMAIL,
    suite: "babysittingCapabilities.integration",
  });
  registerUserEntry({
    userId: OTHER_ADMIN_ID,
    email: OTHER_EMAIL,
    suite: "babysittingCapabilities.integration",
  });
}

async function producePending(admin: ReturnType<typeof createAdmin>) {
  const containment = await buildBabysittingFixtureContainmentPlan(admin, containmentSnapshot());
  const plan = buildBabysittingTeardownPlan(fixtureSnapshot(), containment);
  return buildPendingTeardownRecord(plan);
}

describe("PR67 babysitting teardown caller binding", () => {
  it("stage-1 producer binds the lowest eligible run-owned caller for non-QA-tagged pending bookings", async () => {
    registerRunOwnedAdmins();
    const state = createState();
    const admin = createAdmin(state);
    const plan = await buildBabysittingFixtureContainmentPlan(admin, containmentSnapshot());

    expect(plan.blocked).toBe(false);
    expect(
      plan.actions.some((row: { actionType: string }) => row.actionType === "cancel_booking"),
    ).toBe(true);
    expect(
      plan.actions.some(
        (row: { id: string; actionType: string }) =>
          row.actionType === "cancel_booking" && row.id === BOOKING_ID,
      ),
    ).toBe(true);
    expect(plan.bookingCaller).toMatchObject({
      userId: CALLER_ID,
      callerClass: BOOKING_CALLER_CLASS,
    });
    expect(plan.callerAuthMode).toBe(CALLER_AUTH_MODE);
    expect(plan.callerSelectionPolicy).toBe(BOOKING_CALLER_SELECTION_POLICY);
    expect(plan.eligibleCallerCount).toBe(2);
    expect(state.mutations).toEqual([]);
  });

  it("shared integration producer still leaves bookingCaller null, including when cancel is planned", async () => {
    registerRunOwnedAdmins();
    const untagged = createState({ bookingNotes: "existing babysitting booking" });
    const untaggedPlan = await buildIntegrationContainmentPlan(
      createAdmin(untagged),
      containmentSnapshot(),
    );
    expect(untaggedPlan.bookingCaller).toBeNull();
    expect(
      untaggedPlan.actions.some(
        (row: { actionType: string }) => row.actionType === "cancel_booking",
      ),
    ).toBe(false);

    const tagged = createState({ bookingNotes: "QA existing babysitting booking" });
    const taggedPlan = await buildIntegrationContainmentPlan(
      createAdmin(tagged),
      containmentSnapshot(),
    );
    expect(
      taggedPlan.actions.some((row: { actionType: string }) => row.actionType === "cancel_booking"),
    ).toBe(true);
    expect(taggedPlan.bookingCaller).toBeNull();
    expect(taggedPlan.callerAuthMode).toBeNull();
    expect(untagged.mutations).toEqual([]);
    expect(tagged.mutations).toEqual([]);
  });

  it("serializes, loads, and owner-approves the producer plan including the bound caller", async () => {
    registerRunOwnedAdmins();
    const state = createState();
    const admin = createAdmin(state);
    const pending = await producePending(admin);
    const dir = mkdtempSync(path.join(tmpdir(), "pr67-caller-pending-"));
    const file = path.join(dir, "pending.json");
    persistPendingTeardown(pending, file);
    const loaded = loadPendingTeardown(file);

    expect(loaded.fingerprint).toBe(pending.fingerprint);
    expect(loaded.plan.containment.plan.bookingCaller.userId).toBe(CALLER_ID);
    expect(() =>
      assertOwnerApprovedTeardown({
        approval: { fingerprint: loaded.fingerprint, plan: loaded.plan },
        currentPlan: loaded.plan,
      }),
    ).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it("missing caller fails before teardown writes", async () => {
    registerRunOwnedAdmins();
    const state = createState();
    const admin = createAdmin(state);
    const pending = await producePending(admin);
    const mutated = structuredClone(pending);
    mutated.plan.containment.plan.bookingCaller = null;

    await expect(
      resumeBabysittingTeardownFromPending({
        mode: "execute",
        pending: mutated,
        ownerFingerprint: pending.fingerprint,
        admin,
        authDeps: authDeps(state),
      }),
    ).rejects.toThrow(/bound run-owned booking caller|does not match the bound/i);
    expect(state.mutations).toEqual([]);
    expect(state.bookings[0]?.status).toBe("pending");
  });

  it("ineligible caller fails authentication before teardown writes", async () => {
    registerRunOwnedAdmins();
    const state = createState();
    const admin = createAdmin(state);
    const pending = await producePending(admin);
    state.roles.set(CALLER_ID, []);

    await expect(
      resumeBabysittingTeardownFromPending({
        mode: "execute",
        pending,
        ownerFingerprint: pending.fingerprint,
        admin,
        authDeps: authDeps(state),
      }),
    ).rejects.toThrow(/eligible run-owned booking caller|caller-missing-admin-role/i);
    expect(state.mutations).toEqual([]);
    expect(state.bookings[0]?.status).toBe("pending");
  });

  it("changed live caller drifts and fails before teardown writes", async () => {
    registerRunOwnedAdmins();
    const state = createState();
    const admin = createAdmin(state);
    const pending = await producePending(admin);
    expect(pending.plan.containment.plan.bookingCaller.userId).toBe(CALLER_ID);

    const callerProfile = state.profiles.get(CALLER_ID);
    if (callerProfile) callerProfile.is_suspended = true;

    await expect(
      resumeBabysittingTeardownFromPending({
        mode: "execute",
        pending,
        ownerFingerprint: pending.fingerprint,
        admin,
        authDeps: authDeps(state),
      }),
    ).rejects.toThrow(/drifted from the owner-approved fingerprint/i);
    expect(state.mutations).toEqual([]);
    expect(state.bookings[0]?.status).toBe("pending");
  });

  it("changed pending caller invalidates approval before teardown writes", async () => {
    registerRunOwnedAdmins();
    const state = createState();
    const admin = createAdmin(state);
    const pending = await producePending(admin);
    const mutated = structuredClone(pending);
    mutated.plan.containment.plan.bookingCaller = {
      ...mutated.plan.containment.plan.bookingCaller,
      userId: OTHER_ADMIN_ID,
    };

    await expect(
      resumeBabysittingTeardownFromPending({
        mode: "execute",
        pending: mutated,
        ownerFingerprint: pending.fingerprint,
        admin,
        authDeps: authDeps(state, { verifyUserId: OTHER_ADMIN_ID }),
      }),
    ).rejects.toThrow(
      /does not match the bound reviewed plan|does not match the bound containment/i,
    );
    expect(state.mutations).toEqual([]);
  });

  it("approved valid caller authenticates from the fingerprinted plan and reaches scoped cancellation", async () => {
    registerRunOwnedAdmins();
    const state = createState();
    const admin = createAdmin(state);
    const pending = await producePending(admin);
    const dir = mkdtempSync(path.join(tmpdir(), "pr67-caller-resume-"));
    const file = path.join(dir, "pending.json");
    persistPendingTeardown(pending, file);
    const loaded = loadPendingTeardown(file);
    const deps = authDeps(state);

    const result = await resumeBabysittingTeardownFromPending({
      mode: "execute",
      pending: loaded,
      ownerFingerprint: loaded.fingerprint,
      admin,
      authDeps: deps,
    });

    expect(result.writesPerformed).toBe(true);
    expect(result.residueActive).toBe(true);
    expect(result.residueVerified).toBe(false);
    expect(deps.generateLink).toHaveBeenCalledWith(CALLER_EMAIL);
    expect(deps.rpc).toHaveBeenCalledWith(
      "cancel_booking",
      expect.objectContaining({ p_booking_id: BOOKING_ID }),
    );
    expect(state.mutations.some((row) => row === `rpc.cancel_booking:${BOOKING_ID}`)).toBe(true);
    expect(state.bookings[0]?.status).toBe("cancelled");
    expect(loaded.plan.containment.plan.bookingCaller.userId).toBe(CALLER_ID);
    rmSync(dir, { recursive: true, force: true });
  });
});
