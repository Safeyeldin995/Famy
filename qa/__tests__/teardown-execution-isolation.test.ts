import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import {
  buildCleanupPlan,
  computePlanFingerprint,
} from "../teardown-planner.mjs";
import { executeApprovedCleanupPlan, assessDestructiveCleanupEligibility } from "../teardown-core.mjs";
import { verifyUserFullyRemoved, USER_REMOVAL_PREDICATES } from "../teardown-verification.mjs";
import { parseCleanupArgs } from "../cleanup-args.mjs";
import {
  readRegistry,
  registerUserEntry,
  removeRegistryUsers,
  recordRecoveryFailure,
} from "../registry.mjs";
import { useIsolatedRegistry } from "./registry-test-harness.ts";

const PROJECT_REF = "bfwveoqbyqlhixjvdzha";

function createTwoUserAdmin(options = {}) {
  const failUsers = new Set(options.failDeleteUsers ?? ["user-a"]);
  const auditBlocked = new Set(options.auditBlockedUsers ?? []);
  const ticketMessageUsers = new Set(options.ticketMessageUsers ?? []);
  const bannedUsers = new Set();
  const suspendedProfiles = new Set();
  const calls = [];

  const admin = {
    auth: {
      admin: {
        getUserById: vi.fn(async (userId) => {
          if (bannedUsers.has(userId)) {
            return {
              data: {
                user: {
                  id: userId,
                  email: "qa-a@famio.local",
                  banned_until: new Date(Date.now() + 86400000 * 365).toISOString(),
                  ban_duration: "876000h",
                  deleted_at: null,
                },
              },
              error: null,
            };
          }
          return {
            data: {
              user: auditBlocked.has(userId)
                ? { id: userId, email: "qa-a@famio.local", deleted_at: null }
                : failUsers.has(userId)
                  ? { id: userId, email: "qa-a@famio.local", deleted_at: null }
                  : null,
            },
            error: null,
          };
        }),
        deleteUser: vi.fn(async (userId) => {
          calls.push({ op: "auth.deleteUser", userId });
          if (auditBlocked.has(userId)) {
            return { error: { message: "audit fk block", code: "23503" } };
          }
          return { error: null };
        }),
        updateUserById: vi.fn(async (userId, attrs) => {
          calls.push({ op: "auth.updateUserById", userId, attrs });
          if (attrs.ban_duration) bannedUsers.add(userId);
          return { data: { user: { id: userId } }, error: null };
        }),
        signOut: vi.fn(async (userId, scope) => {
          calls.push({ op: "auth.signOut", userId, scope });
          return { error: null };
        }),
      },
    },
    from: vi.fn((table) => {
      const select = vi.fn((_cols, opts) => {
        if (table === "ticket_messages" && !(opts?.count === "exact" && opts?.head)) {
          return {
            in: vi.fn(async (column, ids) => {
              if (column === "ticket_id" && ids.length > 0 && ticketMessageUsers.has("user-a")) {
                return { data: [{ id: "msg-1" }], error: null };
              }
              return { data: [], error: null };
            }),
            eq: vi.fn(async () => ({ data: [], error: null })),
          };
        }

        return {
          eq: vi.fn((column, value) => {
            if (opts?.count === "exact" && opts?.head) {
              if (table === "audit_logs" && column === "actor_id") {
                return Promise.resolve({ count: auditBlocked.has(value) ? 1 : 0, error: null });
              }
              if (table === "ticket_messages" && column === "author_id") {
                return Promise.resolve({ count: ticketMessageUsers.has(value) ? 1 : 0, error: null });
              }
              if (table === "support_tickets" && column === "user_id") {
                return Promise.resolve({ count: ticketMessageUsers.has(value) ? 1 : 0, error: null });
              }
              return Promise.resolve({ count: 0, error: null });
            }
            if (table === "profiles" && column === "id") {
              return {
                maybeSingle: vi.fn(async () => ({
                  data: {
                    full_name: "QA_test",
                    is_suspended: suspendedProfiles.has(value),
                  },
                  error: null,
                })),
              };
            }
            if (table === "bookings" && column === "customer_id") {
              return Promise.resolve({ data: value === "user-a" ? [{ id: "booking-a" }] : [], error: null });
            }
            if (table === "providers" && column === "profile_id") {
              return Promise.resolve({ data: [], error: null });
            }
            if (table === "support_tickets" && column === "user_id") {
              const ticketIds = ticketMessageUsers.has(value) ? [{ id: "ticket-1" }] : [];
              return Promise.resolve({ data: ticketIds, error: null });
            }
            return {
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              in: vi.fn(async () => ({ data: [], error: null })),
            };
          }),
          in: vi.fn(async () => ({ data: [], error: null })),
          ilike: vi.fn(async () => ({ data: [], error: null })),
        };
      });

      return {
        select,
        update: vi.fn((payload) => ({
          eq: vi.fn(async (_column, value) => {
            calls.push({ op: "update", table, payload, value });
            if (table === "profiles" && payload.is_suspended) suspendedProfiles.add(value);
            return { error: null };
          }),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn((column, value) => {
            if (table === "user_roles" && column === "user_id") {
              return {
                eq: vi.fn(async () => {
                  calls.push({ op: "delete", table, column, value });
                  return { error: null };
                }),
              };
            }
            return (async () => {
              calls.push({ op: "delete", table, value });
              if (table === "bookings" && failUsers.has("user-a") && value === "booking-a") {
                return { error: { message: "fk blocked", code: "23503" } };
              }
              return { error: null };
            })();
          }),
          in: vi.fn(async () => ({ error: null })),
        })),
      };
    }),
    _calls: calls,
  };

  return admin;
}

describe("guard before first mutation", () => {
  it("causes zero mutations when QA guard fails immediately before execution", async () => {
    const envGuard = await import("../env-guard.mjs");
    const guardSpy = vi.spyOn(envGuard, "assertQaWriteGuard").mockImplementation(() => {
      throw new Error("QA guard blocked");
    });

    const admin = createTwoUserAdmin({ failDeleteUsers: [] });
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["user-b"],
      registryIds: new Set(["user-b"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    await expect(executeApprovedCleanupPlan(admin, plan)).rejects.toThrow("QA guard blocked");
    expect(admin._calls.filter((call) => call.op === "delete")).toHaveLength(0);
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();

    guardSpy.mockRestore();
  });
});

describe("executeApprovedCleanupPlan isolation", () => {
  useIsolatedRegistry();

  it("allows user B to succeed when user A deletion fails", async () => {
    const admin = createTwoUserAdmin({ failDeleteUsers: ["user-a"] });
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["user-a", "user-b"],
      registryIds: new Set(["user-a", "user-b"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    const result = await executeApprovedCleanupPlan(admin, plan);
    expect(result.succeeded).toEqual(["user-b"]);
    expect(result.failed.map((row) => row.userId)).toContain("user-a");
    expect(result.retained.map((row) => row.userId)).not.toContain("user-a");
    expect(result.failed.map((row) => row.userId)).not.toContain("user-b");
  });

  it("does not mark users failed when a shared QA resource deletion fails", async () => {
    const admin = createTwoUserAdmin({ failDeleteUsers: [] });
    admin.from = vi.fn((table) => {
      if (table === "services") {
        return {
          select: vi.fn(() => ({
            ilike: vi.fn(async () => ({
              data: [{ id: "svc-qa", name_en: "QA_test_service", slug: "qa-test" }],
              error: null,
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: { message: "still referenced", code: "23503" } })),
          })),
        };
      }
      return createTwoUserAdmin().from(table);
    });

    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["user-b"],
      registryIds: new Set(["user-b"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    const result = await executeApprovedCleanupPlan(admin, plan);
    expect(result.succeeded).toEqual(["user-b"]);
    expect(result.resourceFailures.length).toBeGreaterThan(0);
    expect(result.failed.map((row) => row.userId)).not.toContain("user-b");
  });
});

describe("registry and recovery per-user outcomes", () => {
  useIsolatedRegistry();

  it("removes only succeeded user B from registry while retaining user A", async () => {
    registerUserEntry({ userId: "user-a", email: "qa-a@famio.local" });
    registerUserEntry({ userId: "user-b", email: "qa-b@famio.local" });

    const admin = createTwoUserAdmin({ failDeleteUsers: ["user-a"] });
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["user-a", "user-b"],
      registryIds: new Set(["user-a", "user-b"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    const result = await executeApprovedCleanupPlan(admin, plan);
    if (result.succeeded.length) removeRegistryUsers(result.succeeded);
    for (const row of result.retained) {
      recordRecoveryFailure({ id: row.userId, kind: "user", reason: row.reason });
    }

    const reg = readRegistry();
    expect(result.succeeded).toEqual(["user-b"]);
    expect(reg.users.some((u) => u.userId === "user-a")).toBe(true);
    expect(reg.users.some((u) => u.userId === "user-b")).toBe(false);
    expect((reg.recovery ?? []).some((entry) => entry.id === "user-a")).toBe(true);
  });
});

describe("immutable support and audit residue", () => {
  useIsolatedRegistry();

  it("detects immutable ticket rows during planning and does not schedule ticket_messages deletes", async () => {
    const admin = createTwoUserAdmin({ ticketMessageUsers: ["user-a"] });
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["user-a"],
      registryIds: new Set(["user-a"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    expect(plan.deletions.some((row) => row.table === "ticket_messages")).toBe(false);
    expect(plan.retained.some((row) => row.table === "ticket_messages" && row.ownerUserId === "user-a")).toBe(true);
    expect(plan.retained.some((row) => row.table === "support_tickets" && row.ownerUserId === "user-a")).toBe(true);
  });

  it("prevents full removal when ticket_messages remain", async () => {
    const admin = createTwoUserAdmin({ ticketMessageUsers: ["user-a"] });
    const result = await verifyUserFullyRemoved(admin, "user-a");
    expect(result.removed).toBe(false);
    expect(result.remaining.some((label) => label.includes("ticket_messages"))).toBe(true);
  });

  it("prevents full removal when support_tickets remain", async () => {
    const admin = createTwoUserAdmin({ ticketMessageUsers: ["user-a"] });
    const result = await verifyUserFullyRemoved(admin, "user-a");
    expect(result.remaining).toContain("support_tickets");
  });

  it("classifies audit-log residue as terminal_disabled, never succeeded", async () => {
    const admin = createTwoUserAdmin({ auditBlockedUsers: ["user-a"], failDeleteUsers: [] });
    const verification = await verifyUserFullyRemoved(admin, "user-a");
    expect(verification.removed).toBe(false);
    expect(verification.terminalDisabled).toBe(true);
    expect(verification.remaining).toContain("audit_logs(actor)");

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
  });
});

describe("cleanup CLI hardening", () => {
  it("rejects unknown, duplicate, and malformed flags", () => {
    expect(parseCleanupArgs(["--unknown"]).mode).toBe("rejected");
    expect(parseCleanupArgs(["--execute", "--execute", "--confirm=I-UNDERSTAND-QA-CLEANUP", "--plan-fingerprint=abc"]).mode).toBe("rejected");
    expect(parseCleanupArgs(["--execute", "--confirm=", "--plan-fingerprint=abc"]).mode).toBe("rejected");
    expect(parseCleanupArgs([
      "--execute",
      "--confirm=I-UNDERSTAND-QA-CLEANUP",
      "--plan-fingerprint=not-a-valid-fingerprint",
    ]).mode).toBe("rejected");
  });

  it("keeps valid execute fingerprint requirement", () => {
    const fp = "a".repeat(64);
    expect(parseCleanupArgs([
      "--execute",
      "--confirm=I-UNDERSTAND-QA-CLEANUP",
      `--plan-fingerprint=${fp}`,
    ])).toEqual({
      mode: "execute",
      confirmValue: "I-UNDERSTAND-QA-CLEANUP",
      planFingerprint: fp,
    });
  });
});

describe("verification predicates", () => {
  it("documents migration-derived predicates including support and audit checks", () => {
    const labels = USER_REMOVAL_PREDICATES.map((row) => row.label);
    expect(labels).toContain("support_tickets");
    expect(labels).toContain("ticket_messages(author)");
    expect(labels).toContain("ticket_messages(via_ticket)");
    expect(labels).toContain("audit_logs(actor)");
  });

  it("orders ticket_messages detection before support_tickets in user scoped steps contract", async () => {
    const { USER_SCOPED_DELETE_STEPS } = await import("../teardown-fk-plan.mjs");
    const tables = USER_SCOPED_DELETE_STEPS.map((step) => step.table ?? "ticket_messages");
    expect(tables.indexOf("ticket_messages")).toBeLessThan(tables.indexOf("support_tickets"));
  });
});

describe("fingerprint drift remains enforced", () => {
  it("still rejects execute when rebuilt plan fingerprint differs", async () => {
    const admin = createTwoUserAdmin();
    const left = await buildCleanupPlan({
      admin,
      candidateUserIds: ["user-b"],
      registryIds: new Set(["user-b"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });
    const right = await buildCleanupPlan({
      admin: createTwoUserAdmin({ failDeleteUsers: [] }),
      candidateUserIds: ["user-b", "user-c"],
      registryIds: new Set(["user-b", "user-c"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });
    expect(computePlanFingerprint(left)).not.toBe(computePlanFingerprint(right));
  });
});

describe("eligibility before mutation remains intact", () => {
  it("assigns zero planned rows to ineligible owners", async () => {
    const admin = createTwoUserAdmin();
    admin.auth.admin.getUserById = vi.fn(async () => ({
      data: { user: { email: "real.user@example.com" } },
      error: null,
    }));

    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["real-user"],
      registryIds: new Set(["real-user"]),
      assessEligibility: assessDestructiveCleanupEligibility,
      projectRef: PROJECT_REF,
    });

    expect(plan.eligibleUsers).toHaveLength(0);
    expect(plan.deletions.filter((row) => row.ownerUserId === "real-user")).toHaveLength(0);
  });
});
