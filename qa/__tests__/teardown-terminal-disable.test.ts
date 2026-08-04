import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  buildCleanupPlan,
  buildFingerprintPayload,
  computePlanFingerprint,
} from "../teardown-planner.mjs";
import { executeApprovedCleanupPlan } from "../teardown-core.mjs";
import {
  executeUserCleanupLifecycle,
  verifyTerminalDisabledStillEligible,
} from "../teardown-user-lifecycle.mjs";
import {
  disableAuthIdentity,
  generateSecureRandomPassword,
  verifyAuthDisabled,
} from "../teardown-terminal-disable.mjs";
import { assessDestructiveCleanupEligibility } from "../teardown-core.mjs";
import { makeLocatorFromKeys } from "../teardown-row-locators.mjs";
import { assertNoWholePlanDeletionBypass, FORBIDDEN_TEARDOWN_BYPASS_NAMES } from "../teardown-fk-contract.mjs";
import { useIsolatedRegistry } from "./registry-test-harness.ts";
import { useIsolatedQaEnv } from "./qa-env-test-harness.ts";
import {
  readRegistry,
  registerUserEntry,
  removeRegistryUsers,
  recordRecoveryFailure,
} from "../registry.mjs";

const PROJECT_REF = "bfwveoqbyqlhixjvdzha";

/**
 * Stateful mock tracking per-user DB-like state for terminal-disable tests.
 */
function createStatefulTerminalAdmin(options: {
  immutableTickets?: boolean;
  auditBlocked?: boolean;
  banVerifyFails?: boolean;
}) {
  const calls = [];
  /** @type {Record<string, any>} */
  const users = {
    "user-a": {
      auth: {
        id: "user-a",
        email: "qa-a@famio.local",
        banned_until: null,
        ban_duration: null,
        deleted_at: null,
      },
      profile: { full_name: "QA_test_user", is_suspended: false },
      bookings: new Set(["booking-1"]),
      providers: new Set(["provider-1"]),
      addresses: new Set(["addr-1"]),
      tickets: options.immutableTickets ? new Set(["ticket-1"]) : new Set(),
      ticketMessages: options.immutableTickets ? new Set(["msg-1"]) : new Set(),
      auditCount: options.auditBlocked ? 1 : 0,
      roles: new Set(["customer", "admin"]),
    },
  };

  const admin = {
    auth: {
      admin: {
        getUserById: vi.fn(async (userId) => {
          const user = users[userId]?.auth;
          if (!user || user.deleted_at) return { data: { user: null }, error: null };
          return { data: { user: { ...user } }, error: null };
        }),
        deleteUser: vi.fn(async (userId) => {
          calls.push({ op: "auth.deleteUser", userId });
          const row = users[userId];
          if (!row) return { error: null };
          if (row.auditCount > 0 || row.ticketMessages.size > 0) {
            return { error: { message: "immutable fk block", code: "23503" } };
          }
          row.auth.deleted_at = new Date().toISOString();
          return { error: null };
        }),
        updateUserById: vi.fn(async (userId, attrs) => {
          calls.push({ op: "auth.updateUserById", userId, attrs });
          const row = users[userId];
          if (!row) return { data: { user: null }, error: { message: "missing" } };
          if (options.banVerifyFails) {
            return { data: { user: row.auth }, error: null };
          }
          if (attrs.ban_duration) {
            row.auth.ban_duration = attrs.ban_duration;
            row.auth.banned_until = new Date(Date.now() + 86400000 * 365 * 100).toISOString();
          }
          return { data: { user: row.auth }, error: null };
        }),
        signOut: vi.fn(async (userId, scope) => {
          calls.push({ op: "auth.signOut", userId, scope });
          return { error: null };
        }),
      },
    },
    from: vi.fn((table) => ({
      select: vi.fn((_cols, opts) => {
        if (opts?.count === "exact" && opts?.head) {
          return {
            eq: vi.fn((column, value) => {
              const row = users[value];
              if (table === "audit_logs" && column === "actor_id") {
                return Promise.resolve({ count: row?.auditCount ?? 0, error: null });
              }
              if (table === "ticket_messages" && column === "author_id") {
                return Promise.resolve({ count: row?.ticketMessages.size ?? 0, error: null });
              }
              if (table === "support_tickets" && column === "user_id") {
                return Promise.resolve({ count: row?.tickets.size ?? 0, error: null });
              }
              return Promise.resolve({ count: 0, error: null });
            }),
            in: vi.fn(async (_column, ids) => {
              if (table === "ticket_messages") {
                const userId = "user-a";
                const count = ids.length > 0 ? (users[userId]?.ticketMessages.size ?? 0) : 0;
                return { count, error: null };
              }
              return { count: 0, error: null };
            }),
          };
        }

        return {
          eq: vi.fn((column, value) => {
            const row = users[value] ?? users["user-a"];
            if (table === "profiles" && column === "id") {
              return {
                maybeSingle: vi.fn(async () => ({
                  data: row?.profile ? { ...row.profile, id: value } : null,
                  error: null,
                })),
              };
            }
            if (table === "bookings" && column === "customer_id") {
              return Promise.resolve({
                data: [...(row?.bookings ?? [])].map((id) => ({ id })),
                error: null,
              });
            }
            if (table === "providers" && column === "profile_id") {
              return Promise.resolve({
                data: [...(row?.providers ?? [])].map((id) => ({ id })),
                error: null,
              });
            }
            if (table === "addresses" && column === "user_id") {
              return Promise.resolve({
                data: [...(row?.addresses ?? [])].map((id) => ({ id })),
                error: null,
              });
            }
            if (table === "support_tickets" && column === "user_id") {
              return Promise.resolve({
                data: [...(row?.tickets ?? [])].map((id) => ({ id })),
                error: null,
              });
            }
            if (table === "user_roles" && column === "user_id") {
              return Promise.resolve({
                data: [...(row?.roles ?? [])].map((role) => ({ id: `${value}-${role}`, role })),
                error: null,
              });
            }
            return {
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              in: vi.fn(async () => ({ data: [], error: null })),
            };
          }),
          in: vi.fn(async (column, ids) => {
            if (table === "ticket_messages" && column === "ticket_id") {
              const row = users["user-a"];
              return {
                data: [...(row?.ticketMessages ?? [])].map((id) => ({ id })),
                error: null,
              };
            }
            const userId = ids[0];
            const row = users[userId] ?? users["user-a"];
            if (table === "addresses" && column === "user_id") {
              return { data: [...(row?.addresses ?? [])].map((id) => ({ id })), error: null };
            }
            if (table === "notifications" && column === "user_id") {
              return { data: [], error: null };
            }
            if (table === "notification_outbox" && column === "recipient_user_id") {
              return { data: [], error: null };
            }
            if (table === "push_subscriptions" && column === "user_id") {
              return { data: [], error: null };
            }
            if (table === "family_members" && column === "customer_id") {
              return { data: [], error: null };
            }
            if (table === "support_tickets" && column === "user_id") {
              return { data: [...(row?.tickets ?? [])].map((id) => ({ id })), error: null };
            }
            if (table === "user_roles" && column === "user_id") {
              return { data: [...(row?.roles ?? [])].map((role) => ({ id: `${userId}-${role}`, role })), error: null };
            }
            if (table === "bookings" && column === "provider_id") {
              return { data: [], error: null };
            }
            if (column === "booking_id") {
              return { data: [], error: null };
            }
            if (column === "provider_id") {
              return { data: [], error: null };
            }
            return { data: [], error: null };
          }),
          ilike: vi.fn(async () => ({ data: [], error: null })),
        };
      }),
      delete: vi.fn(() => {
        /** @type {Record<string, string>} */
        const filters = {};
        const chain = {
          eq(col, val) {
            filters[col] = val;
            return chain;
          },
          then(onFulfilled, onRejected) {
            calls.push({ op: "delete", table, filters: { ...filters } });
            const row = users["user-a"];
            if (table === "bookings" && filters.id) row.bookings.delete(filters.id);
            if (table === "providers" && filters.id) row.providers.delete(filters.id);
            if (table === "addresses" && filters.id) row.addresses.delete(filters.id);
            if (table === "user_roles" && filters.role === "admin") row.roles.delete("admin");
            return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
          },
        };
        return chain;
      }),
      update: vi.fn((payload) => ({
        eq: vi.fn(async (_column, userId) => {
          calls.push({ op: "update", table, payload, userId });
          if (table === "profiles" && users[userId]) {
            users[userId].profile = { ...users[userId].profile, ...payload };
          }
          return { error: null };
        }),
      })),
    })),
    _calls: calls,
    _state: users,
  };

  return admin;
}

describe("terminal disable lifecycle", () => {
  useIsolatedRegistry();
  useIsolatedQaEnv();

  it("preserves QA profile evidence when auth delete is blocked and disables auth for real", async () => {
    const admin = createStatefulTerminalAdmin({ immutableTickets: true });
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["user-a"],
      registryIds: new Set(["user-a"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    const result = await executeApprovedCleanupPlan(admin, plan);
    expect(result.succeeded).not.toContain("user-a");
    expect(result.retained.some((row) => row.reason.includes("terminal_disabled"))).toBe(true);

    expect(admin._state["user-a"].bookings.size).toBe(0);
    expect(admin._state["user-a"].providers.size).toBe(0);
    expect(admin._state["user-a"].addresses.size).toBe(0);
    expect(admin._state["user-a"].ticketMessages.size).toBe(1);
    expect(admin._state["user-a"].profile.is_suspended).toBe(true);
    expect(admin._state["user-a"].profile.full_name.startsWith("QA_")).toBe(true);
    expect(admin._state["user-a"].roles.has("admin")).toBe(false);

    expect(admin.auth.admin.updateUserById).toHaveBeenCalled();
    expect(admin.auth.admin.signOut).not.toHaveBeenCalled();
    const updateCall = admin._calls.find((c) => c.op === "auth.updateUserById");
    expect(updateCall?.attrs?.ban_duration).toBeTruthy();

    const profileDelete = admin._calls.find((c) => c.op === "delete" && c.table === "profiles");
    expect(profileDelete).toBeUndefined();
  });

  it("uses cryptographically secure randomized password during disable", () => {
    const a = generateSecureRandomPassword();
    const b = generateSecureRandomPassword();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("classifies failed ban verification as failed, not terminal_disabled", async () => {
    const admin = createStatefulTerminalAdmin({ auditBlocked: true, banVerifyFails: true });
    const lifecycle = await executeUserCleanupLifecycle(admin, "user-a", {
      deletions: (await buildCleanupPlan({
        admin,
        candidateUserIds: ["user-a"],
        registryIds: new Set(["user-a"]),
        assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
        projectRef: PROJECT_REF,
      })).deletions,
      retained: [],
    });

    expect(lifecycle.outcome).toBe("disable_failed");
    expect(lifecycle.reason).toContain("disable-verify-failed");
    expect(admin._state["user-a"].profile.full_name.startsWith("QA_")).toBe(true);
  });

  it("terminal_disabled remains eligible without registry membership alone", async () => {
    const admin = createStatefulTerminalAdmin({ auditBlocked: true });
    await executeUserCleanupLifecycle(admin, "user-a", {
      deletions: [],
      retained: [],
    });
    const eligible = await verifyTerminalDisabledStillEligible(admin, "user-a");
    expect(eligible).toBe(true);
    const withoutRegistry = await assessDestructiveCleanupEligibility(admin, "user-a", new Set());
    expect(withoutRegistry.eligible).toBe(true);
  });

  it("keeps terminal_disabled users in registry/recovery", async () => {
    registerUserEntry({ userId: "user-a", email: "qa-a@famio.local" });
    const admin = createStatefulTerminalAdmin({ auditBlocked: true });
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["user-a"],
      registryIds: new Set(["user-a"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });
    const result = await executeApprovedCleanupPlan(admin, plan);
    for (const row of result.retained) {
      recordRecoveryFailure({ id: row.userId, kind: "user", reason: row.reason });
    }
    expect(result.succeeded).toHaveLength(0);
    const reg = readRegistry();
    expect(reg.users.some((u) => u.userId === "user-a")).toBe(true);
    expect((reg.recovery ?? []).some((e) => e.id === "user-a")).toBe(true);
  });
});

describe("fingerprint ownership v4", () => {
  it("changes fingerprint when ownerUserIds differs for same row id", async () => {
    const baseDeletion = {
      table: "bookings",
      locator: makeLocatorFromKeys("single", ["id"], [{ id: "booking-1" }]),
      ownerUserIds: ["user-a"],
      phase: "booking",
    };
    const left = {
      version: "6a.2-planner-v4",
      projectRef: PROJECT_REF,
      eligibleUsers: [{ userId: "user-a" }],
      refusedUsers: [],
      deletions: [{ ...baseDeletion, ownerUserIds: ["user-a"] }],
      retained: [],
    };
    const right = {
      ...left,
      deletions: [{ ...baseDeletion, ownerUserIds: ["user-b"] }],
    };
    expect(computePlanFingerprint(left)).not.toBe(computePlanFingerprint(right));
  });

  it("changes fingerprint when resourceKey differs", () => {
    const left = {
      version: "6a.2-planner-v4",
      projectRef: PROJECT_REF,
      eligibleUsers: [],
      refusedUsers: [],
      deletions: [{
        table: "services",
        locator: makeLocatorFromKeys("single", ["id"], [{ id: "svc-1" }]),
        phase: "qa_service",
        resourceKey: "services:svc-1",
      }],
      retained: [],
    };
    const right = {
      ...left,
      deletions: [{ ...left.deletions[0], resourceKey: "services:svc-2" }],
    };
    expect(computePlanFingerprint(left)).not.toBe(computePlanFingerprint(right));
  });

  it("changes fingerprint when retained owner differs", () => {
    const left = {
      version: "6a.2-planner-v4",
      projectRef: PROJECT_REF,
      eligibleUsers: [],
      refusedUsers: [],
      deletions: [],
      retained: [{ table: "ticket_messages", id: "user-a", reason: "immutable", ownerUserId: "user-a", phase: "user_scoped" }],
    };
    const right = {
      ...left,
      retained: [{ table: "ticket_messages", id: "user-b", reason: "immutable", ownerUserId: "user-b", phase: "user_scoped" }],
    };
    expect(computePlanFingerprint(left)).not.toBe(computePlanFingerprint(right));
  });

  it("keeps fingerprint stable when only deletion ordering differs", () => {
    const rowA = {
      table: "addresses",
      locator: makeLocatorFromKeys("single", ["id"], [{ id: "a1" }]),
      ownerUserIds: ["u1"],
      phase: "user_scoped",
      resourceKey: null,
    };
    const rowB = {
      table: "notifications",
      locator: makeLocatorFromKeys("single", ["id"], [{ id: "n1" }]),
      ownerUserIds: ["u1"],
      phase: "user_scoped",
      resourceKey: null,
    };
    const planLeft = {
      version: "6a.2-planner-v4",
      projectRef: PROJECT_REF,
      eligibleUsers: [{ userId: "u1" }],
      refusedUsers: [],
      deletions: [rowA, rowB],
      retained: [],
    };
    const planRight = { ...planLeft, deletions: [rowB, rowA] };
    expect(computePlanFingerprint(planLeft)).toBe(computePlanFingerprint(planRight));
  });
});

describe("deprecated bypass guard", () => {
  it("forbids whole-plan deletion bypass names in teardown operations source", () => {
    const source = fs.readFileSync(new URL("../teardown-operations.mjs", import.meta.url), "utf8");
    for (const name of FORBIDDEN_TEARDOWN_BYPASS_NAMES) {
      expect(source.includes(`export async function ${name}`)).toBe(false);
      expect(source.includes(`export function ${name}`)).toBe(false);
    }
    assertNoWholePlanDeletionBypass(source);
  });
});

describe("disableAuthIdentity unit", () => {
  it("invokes updateUserById with ban and password", async () => {
    const admin = {
      auth: {
        admin: {
          updateUserById: vi.fn(async () => ({ data: { user: { banned_until: new Date(Date.now() + 1e9).toISOString() } }, error: null })),
          signOut: vi.fn(async () => ({ error: null })),
          getUserById: vi.fn(async () => ({
            data: { user: { banned_until: new Date(Date.now() + 1e9).toISOString(), email: "qa-a@famio.local" } },
            error: null,
          })),
        },
      },
    };
    const result = await disableAuthIdentity(admin, "user-1");
    expect(result.ok).toBe(true);
    expect(result.sessionVerified).toBe(false);
    expect(admin.auth.admin.signOut).not.toHaveBeenCalled();
  });
});
