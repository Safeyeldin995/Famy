import { describe, expect, it, vi } from "vitest";
import {
  buildCleanupPlan,
  CLEANUP_PLAN_VERSION,
} from "../teardown-planner.mjs";
import { executeApprovedCleanupPlan } from "../teardown-core.mjs";
import {
  executeUserCleanupLifecycle,
  partitionUserDeletions,
} from "../teardown-user-lifecycle.mjs";
import {
  disableAuthIdentity,
  attemptGlobalSessionRevocation,
  executeTerminalDisable,
  verifyProfileSuspendedQaEvidence,
  SIGNOUT_API_REQUIRES_JWT,
} from "../teardown-terminal-disable.mjs";
import { getLocatorContract } from "../teardown-row-locators.mjs";
import { isDestructiveCleanupEligible } from "../qa-classification.mjs";
import { computeHonestResidueMetrics } from "../teardown-residue-metrics.mjs";
import { REQUIRED_IMMUTABLE_TRIGGERS } from "../teardown-immutable-contract.mjs";
import { OUTCOME_LABELS } from "../teardown-outcomes.mjs";
import { makeLocatorFromKeys } from "../teardown-row-locators.mjs";
import { useIsolatedRegistry } from "./registry-test-harness.ts";

const PROJECT_REF = "bfwveoqbyqlhixjvdzha";

function createImmutableBookingAdmin() {
  const state = {
    bookings: new Set(["booking-retained", "booking-clean"]),
    cancellations: [{ id: "cancel-1", booking_id: "booking-retained" }],
    conversations: [{ id: "conv-1", booking_id: "booking-retained" }],
    messages: [{ id: "msg-1", conversation_id: "conv-1" }],
    auditLogs: [{ id: "audit-1", booking_id: "booking-retained" }],
    bookingLocations: new Set(["booking-retained", "booking-clean"]),
    providers: new Set(["provider-1"]),
    providerDocs: new Set(["doc-1"]),
    profiles: {
      "customer-user": { full_name: "QA_test", is_suspended: false },
      "provider-user": { full_name: "QA Booking Provider", is_suspended: false },
    },
    auth: {
      "customer-user": {
        email: "qa-booking-a-1@famio.local",
        banned_until: null,
        ban_duration: null,
        deleted_at: null,
      },
      "provider-user": {
        email: "phone-201001112233@famio.local",
        banned_until: null,
        ban_duration: null,
        deleted_at: null,
      },
    },
  };

  const admin = {
    auth: {
      admin: {
        getUserById: vi.fn(async (userId) => ({
          data: {
            user: state.auth[userId]
              ? { id: userId, ...state.auth[userId] }
              : null,
          },
          error: null,
        })),
        deleteUser: vi.fn(async () => ({ error: { message: "immutable fk block", code: "23503" } })),
        updateUserById: vi.fn(async (userId, attrs) => {
          if (state.auth[userId]) {
            state.auth[userId] = {
              ...state.auth[userId],
              ban_duration: attrs.ban_duration ?? state.auth[userId].ban_duration,
              banned_until: new Date(Date.now() + 86400000 * 365 * 100).toISOString(),
            };
          }
          return {
            data: { user: { id: userId, ...state.auth[userId] } },
            error: null,
          };
        }),
        signOut: vi.fn(async () => ({ error: { message: "bad_jwt", code: "403" } })),
      },
    },
    from: vi.fn((table) => ({
      select: vi.fn((_cols, opts) => ({
        eq: vi.fn((column, value) => {
          if (opts?.count === "exact" && opts?.head) {
            if (table === "audit_logs" && column === "actor_id") {
              return Promise.resolve({ count: value === "customer-user" ? 1 : 0, error: null });
            }
            if (table === "ticket_messages" && column === "author_id") return Promise.resolve({ count: 0, error: null });
            if (table === "support_tickets" && column === "user_id") return Promise.resolve({ count: 0, error: null });
            if (table === "bookings" && column === "customer_id") {
              return Promise.resolve({ count: value === "customer-user" ? 2 : 0, error: null });
            }
            if (table === "providers" && column === "profile_id") {
              return Promise.resolve({ count: value === "provider-user" ? 1 : 0, error: null });
            }
            return Promise.resolve({ count: 0, error: null });
          }
          if (table === "profiles" && column === "id") {
            return {
              maybeSingle: vi.fn(async () => ({
                data: state.profiles[value]
                  ? { id: value, ...state.profiles[value] }
                  : null,
                error: null,
              })),
            };
          }
          if (table === "bookings" && column === "customer_id") {
            return Promise.resolve({
              data: value === "customer-user"
                ? [{ id: "booking-retained" }, { id: "booking-clean" }]
                : [],
              error: null,
            });
          }
          if (table === "providers" && column === "profile_id") {
            return Promise.resolve({
              data: value === "provider-user" ? [{ id: "provider-1" }] : [],
              error: null,
            });
          }
          if (table === "support_tickets" && column === "user_id") {
            return Promise.resolve({ data: [], error: null });
          }
          if (table === "user_roles" && column === "user_id") {
            return Promise.resolve({ data: [{ id: `${value}-admin`, role: "admin" }], error: null });
          }
          return { maybeSingle: vi.fn(async () => ({ data: null, error: null })), in: vi.fn(async () => ({ data: [], error: null })) };
        }),
        in: vi.fn(async (column, values) => {
          if (table === "booking_cancellations" && column === "booking_id") {
            return {
              data: state.cancellations.filter((row) => values.includes(row.booking_id)),
              error: null,
            };
          }
          if (table === "audit_logs" && column === "booking_id") {
            return {
              data: state.auditLogs.filter((row) => values.includes(row.booking_id)),
              error: null,
            };
          }
          if (table === "conversations" && column === "booking_id") {
            return {
              data: state.conversations.filter((row) => values.includes(row.booking_id)),
              error: null,
            };
          }
          if (table === "messages" && column === "conversation_id") {
            return {
              data: state.messages.filter((row) => values.includes(row.conversation_id)),
              error: null,
            };
          }
          if (table === "booking_locations" && column === "booking_id") {
            return {
              data: [...state.bookingLocations]
                .filter((id) => values.includes(id))
                .map((booking_id) => ({ booking_id })),
              error: null,
            };
          }
          if (table === "bookings" && column === "provider_id") {
            return { data: [], error: null };
          }
          if (table === "provider_documents" && column === "provider_id") {
            return { data: [{ id: "doc-1" }], error: null };
          }
          if (column === "provider_id") return { data: [], error: null };
          if (column === "user_id") return { data: [], error: null };
          if (column === "booking_id") return { data: [], error: null };
          return { data: [], error: null, count: 0 };
        }),
        ilike: vi.fn(async () => ({ data: [], error: null })),
      })),
      delete: vi.fn(() => {
        const filters = {};
        const chain = {
          eq(col, val) {
            filters[col] = val;
            return chain;
          },
          then(onFulfilled, onRejected) {
            if (table === "booking_locations" && filters.booking_id === "booking-clean") {
              state.bookingLocations.delete("booking-clean");
            }
            if (table === "bookings" && filters.id === "booking-clean") {
              state.bookings.delete("booking-clean");
            }
            if (table === "provider_documents" && filters.id === "doc-1") {
              state.providerDocs.delete("doc-1");
            }
            if (table === "providers" && filters.id === "provider-1") {
              state.providers.delete("provider-1");
            }
            if (table === "user_roles" && filters.role === "admin") {
              // ok
            }
            return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
          },
        };
        return chain;
      }),
      update: vi.fn((payload) => ({
        eq: vi.fn(async (_col, userId) => {
          if (table === "profiles" && state.profiles[userId]) {
            state.profiles[userId] = { ...state.profiles[userId], ...payload };
          }
          return { error: null };
        }),
      })),
    })),
    _state: state,
  };

  return admin;
}

describe("immutable booking history planning", () => {
  it("detects booking_cancellations as immutable locator contract", () => {
    expect(getLocatorContract("booking_cancellations").kind).toBe("immutable");
  });

  it("detects messages as immutable locator contract", () => {
    expect(getLocatorContract("messages").kind).toBe("immutable");
  });

  it("retains conversations with messages and does not schedule message deletes", async () => {
    const admin = createImmutableBookingAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["customer-user"],
      registryIds: new Set(["customer-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    expect(plan.deletions.some((row) => row.table === "messages")).toBe(false);
    expect(plan.deletions.some((row) => row.table === "booking_cancellations")).toBe(false);
    expect(plan.retained.some((row) => row.table === "conversations" && row.reason === "immutable-messages-block")).toBe(true);
  });

  it("retains bookings with immutable history and skips impossible booking delete", async () => {
    const admin = createImmutableBookingAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["customer-user"],
      registryIds: new Set(["customer-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    expect(plan.retained.some((row) => row.table === "bookings" && row.reason === "retained-immutable-history")).toBe(true);
    const bookingDeletes = plan.deletions.filter((row) => row.table === "bookings");
    expect(bookingDeletes.every((row) => row.locator.keys.every((key) => key.id === "booking-clean"))).toBe(true);
  });

  it("still deletes safe booking children for deletable bookings", async () => {
    const admin = createImmutableBookingAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["customer-user"],
      registryIds: new Set(["customer-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    expect(plan.deletions.some((row) => row.table === "booking_locations")).toBe(true);
  });

  it("uses planner v5 for immutable-aware planning", async () => {
    const admin = createImmutableBookingAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["customer-user"],
      registryIds: new Set(["customer-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });
    expect(plan.version).toBe(CLEANUP_PLAN_VERSION);
    expect(plan.version).toBe("6a.2-planner-v5");
  });
});

describe("co-owned booking block does not block provider cleanup", () => {
  it("allows provider deletes when coOwnedBlocked is true", () => {
    const deletions = [
      { table: "providers", phase: "provider", ownerUserId: "provider-user" },
      { table: "provider_documents", phase: "provider_child", ownerUserId: "provider-user" },
      { table: "bookings", phase: "booking", ownerUserId: "provider-user" },
    ];
    const { safe } = partitionUserDeletions(deletions, "provider-user", new Set(), { coOwnedBlocked: true });
    expect(safe.some((row) => row.table === "providers")).toBe(true);
    expect(safe.some((row) => row.table === "provider_documents")).toBe(true);
    expect(safe.some((row) => row.table === "bookings")).toBe(false);
  });

  it("cleans provider data when immutable booking history is retained", async () => {
    const admin = createImmutableBookingAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["customer-user", "provider-user"],
      registryIds: new Set(["customer-user", "provider-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    expect(plan.deletions.some((row) => row.table === "provider_documents" && row.ownerUserId === "provider-user")).toBe(true);
    expect(plan.retained.some((row) => row.table === "bookings")).toBe(true);
  });
});

describe("terminal disable session semantics", () => {
  useIsolatedRegistry();

  it("does not call signOut with userId — API requires JWT", async () => {
    expect(SIGNOUT_API_REQUIRES_JWT).toBe(true);
    const admin = {
      auth: {
        admin: {
          updateUserById: vi.fn(async () => ({
            data: { user: { banned_until: new Date(Date.now() + 1e9).toISOString() } },
            error: null,
          })),
          getUserById: vi.fn(async () => ({
            data: { user: { banned_until: new Date(Date.now() + 1e9).toISOString() } },
            error: null,
          })),
          signOut: vi.fn(async () => ({ error: null })),
        },
      },
    };
    const result = await disableAuthIdentity(admin, "user-1");
    expect(result.ok).toBe(true);
    expect(result.sessionVerified).toBe(false);
    expect(admin.auth.admin.signOut).not.toHaveBeenCalled();
  });

  it("attemptGlobalSessionRevocation is fail-closed without JWT", async () => {
    const session = await attemptGlobalSessionRevocation({}, "user-1");
    expect(session.verified).toBe(false);
    expect(session.reason).toContain("no-supported-userid-global-signout");
  });

  it("suspends profile and removes admin even when session revocation unavailable", async () => {
    const admin = createImmutableBookingAdmin();
    const terminal = await executeTerminalDisable(admin, "customer-user", { blockers: ["audit_logs(actor)"] });
    expect(terminal.ok).toBe(true);
    expect(terminal.outcome).toBe(OUTCOME_LABELS.TERMINAL_DISABLED_SESSION_UNVERIFIED);
    expect(terminal.sessionVerified).toBe(false);
    expect(admin.auth.admin.signOut).not.toHaveBeenCalled();
  });

  it("never reports session-unverified outcome as fully verified", async () => {
    const admin = createImmutableBookingAdmin();
    const lifecycle = await executeUserCleanupLifecycle(admin, "customer-user", {
      deletions: [],
      retained: [{ table: "audit_logs", id: "audit-1", ownerUserId: "customer-user", reason: "immutable-audit-log-block" }],
    });
    expect(lifecycle.outcome).not.toBe(OUTCOME_LABELS.TERMINAL_DISABLED_VERIFIED);
    expect(lifecycle.outcome).toBe(OUTCOME_LABELS.TERMINAL_DISABLED_SESSION_UNVERIFIED);
  });
});

describe("canonical QA classification for real fixtures", () => {
  it("accepts qa-*@famio.local emails", () => {
    expect(isDestructiveCleanupEligible({ email: "qa-booking-a-1@famio.local", inRegistry: false })).toBe(true);
  });

  it("accepts QA Booking Provider naming with phone famio email and registry", () => {
    expect(isDestructiveCleanupEligible({
      email: "phone-201001112233@famio.local",
      fullName: "QA Booking Provider",
      inRegistry: true,
    })).toBe(true);
  });

  it("verifyProfileSuspendedQaEvidence uses canonical classification not QA_ prefix alone", async () => {
    const admin = createImmutableBookingAdmin();
    await admin.from("profiles").update({ is_suspended: true }).eq("id", "provider-user");
    const check = await verifyProfileSuspendedQaEvidence(admin, "provider-user");
    expect(check.ok).toBe(true);
  });
});

describe("honest residue metrics", () => {
  it("reports immutable history separately from active operational residue", () => {
    const metrics = computeHonestResidueMetrics({
      plan: {
        retained: [
          { table: "bookings", reason: "retained-immutable-history" },
          { table: "messages", reason: "immutable-booking-message" },
          { table: "services", reason: "booking-reference-remaining" },
        ],
        counts: { eligible_users: 2 },
      },
      outcomes: new Map([
        ["u1", { outcome: OUTCOME_LABELS.TERMINAL_DISABLED_SESSION_UNVERIFIED }],
      ]),
      succeeded: [],
      failed: [],
    });

    expect(metrics.retained_immutable_history).toBeGreaterThan(0);
    expect(metrics.terminal_disabled_identities).toBe(1);
    expect(metrics.deletable_QA_resources).toBe(1);
  });
});

describe("immutable migration contract", () => {
  it("requires all unconditional immutable triggers in migrations", () => {
    expect(Object.keys(REQUIRED_IMMUTABLE_TRIGGERS)).toEqual(
      expect.arrayContaining(["booking_cancellations", "messages", "audit_logs", "ticket_messages"]),
    );
  });
});

describe("per-user protections remain", () => {
  it("does not schedule impossible parent delete when children are immutable", async () => {
    const admin = createImmutableBookingAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["customer-user"],
      registryIds: new Set(["customer-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });
    const retainedBookingIds = new Set(plan.retained.filter((row) => row.table === "bookings").map((row) => row.id));
    for (const row of plan.deletions.filter((entry) => entry.table === "bookings")) {
      for (const key of row.locator.keys) {
        expect(retainedBookingIds.has(key.id)).toBe(false);
      }
    }
  });
});
