import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildCleanupPlan,
  buildFingerprintPayload,
  computePlanFingerprint,
  REJECTED_PLAN_FINGERPRINT_V3,
} from "../teardown-planner.mjs";
import { executeApprovedCleanupPlan } from "../teardown-core.mjs";
import { finalizeUserCleanupOutcome } from "../teardown-user-lifecycle.mjs";
import { makeLocatorFromKeys } from "../teardown-row-locators.mjs";
import {
  countBookingMetrics,
  normalizePlanDeletions,
} from "../teardown-plan-normalize.mjs";
import {
  classifyRecoveryEntryId,
  summarizeRecoveryJournal,
} from "../teardown-recovery-classify.mjs";
import { describeRetainedServiceTwoPass } from "../teardown-retained-services.mjs";
import { configureRegistryRootForTests, resetRegistryRootForTests } from "../registry.mjs";
import { useIsolatedRegistry } from "./registry-test-harness.ts";
import { useIsolatedQaEnv } from "./qa-env-test-harness.ts";

const PROJECT_REF = "bfwveoqbyqlhixjvdzha";

function createCoOwnedBookingAdmin(options = {}) {
  const failCoOwnedBooking = options.failCoOwnedBooking ?? false;
  const transientFailFirstAttempt = options.transientFailFirstAttempt ?? false;
  const bookingDeleteAttempts = new Map();
  const calls = [];

  const state = {
    bookings: new Set(["booking-shared"]),
    bookingLocations: new Set(["booking-shared"]),
    profiles: new Set(["customer-user", "provider-user", "unrelated-user"]),
    providers: new Set(["provider-1"]),
    addresses: new Set(["addr-customer"]),
  };

  const admin = {
    auth: {
      admin: {
        getUserById: vi.fn(async (userId) => ({
          data: {
            user: state.profiles.has(userId)
              ? { id: userId, email: `${userId}@famio.local`, deleted_at: null }
              : null,
          },
          error: null,
        })),
        deleteUser: vi.fn(async (userId) => {
          calls.push({ op: "auth.deleteUser", userId });
          state.profiles.delete(userId);
          return { error: null };
        }),
        updateUserById: vi.fn(async () => ({ data: { user: {} }, error: null })),
        signOut: vi.fn(async () => ({ error: null })),
      },
    },
    from: vi.fn((table) => {
      const buildDeleteChain = (tableName) => {
        /** @type {Record<string, string>} */
        const filters = {};
        const chain = {
          eq(col, val) {
            filters[col] = String(val);
            return chain;
          },
          then(onFulfilled, onRejected) {
            calls.push({ op: "delete", table: tableName, filters: { ...filters } });
            if (tableName === "bookings" && filters.id === "booking-shared") {
              const attempts = (bookingDeleteAttempts.get("booking-shared") ?? 0) + 1;
              bookingDeleteAttempts.set("booking-shared", attempts);
              if (failCoOwnedBooking) {
                return Promise.resolve({ error: { message: "fk blocked", code: "23503" } }).then(onFulfilled, onRejected);
              }
              if (transientFailFirstAttempt && attempts === 1) {
                return Promise.resolve({ error: { message: "transient", code: "40001" } }).then(onFulfilled, onRejected);
              }
              state.bookings.delete(filters.id);
            }
            if (tableName === "booking_locations" && filters.booking_id) {
              state.bookingLocations.delete(filters.booking_id);
            }
            if (tableName === "profiles" && filters.id) state.profiles.delete(filters.id);
            if (tableName === "providers" && filters.id) state.providers.delete(filters.id);
            if (tableName === "addresses" && filters.id) state.addresses.delete(filters.id);
            return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
          },
        };
        return chain;
      };

      return {
        select: vi.fn((_cols, opts) => ({
          eq: vi.fn((column, value) => {
            if (opts?.count === "exact" && opts?.head) {
              if (table === "bookings" && column === "customer_id") {
                return Promise.resolve({ count: state.bookings.size && value === "customer-user" ? 1 : 0, error: null });
              }
              if (table === "providers" && column === "profile_id") {
                return Promise.resolve({ count: state.providers.size && value === "provider-user" ? 1 : 0, error: null });
              }
              if (table === "addresses" && column === "user_id") {
                return Promise.resolve({ count: state.addresses.size && value === "customer-user" ? 1 : 0, error: null });
              }
              return Promise.resolve({ count: 0, error: null });
            }
            if (table === "profiles" && column === "id") {
              return {
                maybeSingle: vi.fn(async () => ({
                  data: state.profiles.has(value) ? { full_name: "QA_test", id: value, is_suspended: false } : null,
                  error: null,
                })),
                data: state.profiles.has(value) ? [{ id: value }] : [],
                error: null,
              };
            }
            if (table === "bookings" && column === "customer_id") {
              return Promise.resolve({
                data: value === "customer-user" ? [{ id: "booking-shared" }] : [],
                error: null,
              });
            }
            if (table === "providers" && column === "profile_id") {
              if (opts?.count === "exact" && opts?.head) {
                return Promise.resolve({ count: state.providers.size && value === "provider-user" ? 1 : 0, error: null });
              }
              return Promise.resolve({
                data: value === "provider-user" && state.providers.size ? [{ id: "provider-1" }] : [],
                error: null,
              });
            }
            if (table === "providers" && column === "id") {
              return {
                in: vi.fn(async () => ({
                  data: state.providers.size ? [{ id: "provider-1" }] : [],
                  error: null,
                })),
              };
            }
            return {
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              in: vi.fn(async () => ({ data: [], error: null })),
            };
          }),
          in: vi.fn(async (column, values) => {
            if (table === "bookings" && column === "provider_id") {
              if (opts?.count === "exact" && opts?.head) {
                return { count: state.bookings.size ? 1 : 0, error: null };
              }
              return { data: state.bookings.size ? [{ id: "booking-shared" }] : [], error: null };
            }
            if (table === "booking_locations" && column === "booking_id") {
              return {
                data: values.some((v) => state.bookingLocations.has(v)) ? [{ booking_id: "booking-shared" }] : [],
                error: null,
              };
            }
            if (table === "addresses" && column === "user_id") {
              return {
                data: values.includes("customer-user") && state.addresses.size
                  ? [{ id: "addr-customer" }]
                  : [],
                error: null,
              };
            }
            return { data: [], error: null, count: 0 };
          }),
          ilike: vi.fn(async () => ({ data: [], error: null })),
        })),
        delete: vi.fn(() => buildDeleteChain(table)),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      };
    }),
    _calls: calls,
    _state: state,
    _bookingDeleteAttempts: bookingDeleteAttempts,
  };

  return admin;
}

describe("co-owned plan normalization", () => {
  it("stores both owners in sorted ownerUserIds for a shared booking", async () => {
    const admin = createCoOwnedBookingAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["customer-user", "provider-user"],
      registryIds: new Set(["customer-user", "provider-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    const booking = plan.deletions.find((row) => row.table === "bookings");
    expect(booking?.coOwned).toBe(true);
    expect(booking?.ownerUserIds).toEqual(["customer-user", "provider-user"]);
    expect(plan.counts.unique_owned_bookings).toBe(1);
    expect(plan.counts.booking_owner_attributions).toBe(2);
  });

  it("changes fingerprint when owner set changes", () => {
    const base = {
      version: "6a.2-planner-v5",
      projectRef: PROJECT_REF,
      eligibleUsers: [{ userId: "a" }],
      refusedUsers: [],
      retained: [],
      deletions: [{
        table: "bookings",
        phase: "booking",
        coOwned: true,
        ownerUserIds: ["customer-user", "provider-user"],
        locator: makeLocatorFromKeys("single", ["id"], [{ id: "booking-shared" }]),
      }],
    };
    const changed = {
      ...base,
      deletions: [{ ...base.deletions[0], ownerUserIds: ["customer-user", "other-user"] }],
    };
    expect(computePlanFingerprint(base)).not.toBe(computePlanFingerprint(changed));
  });

  it("rejects the old v3 fingerprint for normalized v4 plans", async () => {
    const admin = createCoOwnedBookingAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["customer-user", "provider-user"],
      registryIds: new Set(),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });
    expect(plan.fingerprint).not.toBe(REJECTED_PLAN_FINGERPRINT_V3);
    expect(buildFingerprintPayload(plan).deletions[0].ownerUserIds).toEqual(["customer-user", "provider-user"]);
  });
});

describe("co-owned execution", () => {
  useIsolatedRegistry();
  useIsolatedQaEnv();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes shared booking and child rows once while attributing both owners", async () => {
    const admin = createCoOwnedBookingAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["customer-user", "provider-user", "unrelated-user"],
      registryIds: new Set(["customer-user", "provider-user", "unrelated-user"]),
      assessEligibility: async ( _admin, userId) => ({
        eligible: userId !== "unrelated-user",
        reason: userId === "unrelated-user" ? "insufficient-qa-signals" : "eligible",
      }),
      projectRef: PROJECT_REF,
    });

    const result = await executeApprovedCleanupPlan(admin, plan);
    const bookingDeletes = admin._calls.filter((call) => call.op === "delete" && call.table === "bookings");
    const locationDeletes = admin._calls.filter((call) => call.op === "delete" && call.table === "booking_locations");

    expect(bookingDeletes).toHaveLength(1);
    expect(locationDeletes).toHaveLength(1);
    expect(result.succeeded.sort()).toEqual(["customer-user", "provider-user"]);
    expect(result.failed.some((row) => row.userId === "unrelated-user")).toBe(false);
  });

  it("limits co-owned delete failure to associated owners only", async () => {
    const admin = createCoOwnedBookingAdmin({ failCoOwnedBooking: true });
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["customer-user", "provider-user", "unrelated-user"],
      registryIds: new Set(["customer-user", "provider-user", "unrelated-user"]),
      assessEligibility: async (_admin, userId) => ({
        eligible: userId !== "unrelated-user",
        reason: userId === "unrelated-user" ? "insufficient-qa-signals" : "eligible",
      }),
      projectRef: PROJECT_REF,
    });

    const result = await executeApprovedCleanupPlan(admin, plan);
    expect(result.succeeded).not.toContain("customer-user");
    expect(result.failed.map((row) => row.userId)).toContain("customer-user");
    expect(result.coOwnedFailures.length).toBeGreaterThan(0);
    // Provider-owned rows may still be cleaned when only booking phases are blocked.
    expect(result.succeeded).toContain("provider-user");
  });

  it("uses final verification so transient first-attempt failure can still succeed", async () => {
    const admin = createCoOwnedBookingAdmin();
    vi.spyOn(await import("../teardown-verification.mjs"), "verifyUserFullyRemoved")
      .mockResolvedValue({ removed: true, remaining: [], terminalDisabled: false });

    const outcome = await finalizeUserCleanupOutcome(admin, "customer-user", {
      retained: [],
      coOwnedFailures: [{ ownerUserIds: ["customer-user", "provider-user"], reason: "co-owned-delete-failed", errors: [{ message: "transient" }] }],
      mutation: {
        safeSlice: { ok: false, errors: [{ message: "transient safe slice" }] },
        authDelete: { ok: true, error: null },
        profileDelete: { ok: true, error: null },
        terminal: null,
      },
    });

    expect(outcome.outcome).toBe("hard_deleted");
  });

  it("blocks success when final residue remains", async () => {
    const admin = createCoOwnedBookingAdmin();
    const outcome = await finalizeUserCleanupOutcome(admin, "customer-user", {
      retained: [],
      coOwnedFailures: [],
      mutation: {
        safeSlice: { ok: true, errors: [] },
        authDelete: { ok: true, error: null },
        profileDelete: { ok: true, error: null },
        terminal: null,
      },
    });
    expect(outcome.outcome).toBe("failed");
    expect(outcome.reason).toContain("residue-remaining");
  });

  it("places each user in exactly one outcome bucket", async () => {
    const admin = createCoOwnedBookingAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["customer-user", "provider-user"],
      registryIds: new Set(["customer-user", "provider-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });
    const result = await executeApprovedCleanupPlan(admin, plan);
    for (const userId of ["customer-user", "provider-user"]) {
      const buckets = [
        result.succeeded.includes(userId),
        result.failed.some((row) => row.userId === userId),
        result.retained.some((row) => row.userId === userId),
        result.refused.some((row) => row.userId === userId),
      ].filter(Boolean);
      expect(buckets).toHaveLength(1);
    }
  });
});

describe("metrics and retained services", () => {
  it("reports unique count 1 and attribution count 2", () => {
    const metrics = countBookingMetrics([
      {
        table: "bookings",
        ownerUserIds: ["customer-user", "provider-user"],
        locator: makeLocatorFromKeys("single", ["id"], [{ id: "booking-shared" }]),
      },
    ]);
    expect(metrics.uniqueOwnedBookings).toBe(1);
    expect(metrics.bookingOwnerAttributions).toBe(2);
  });

  it("documents retained-service two-pass behavior", () => {
    expect(describeRetainedServiceTwoPass(2)).toContain("fresh dry-run");
    expect(describeRetainedServiceTwoPass(2)).toContain("new fingerprint");
  });
});

describe("recovery journal classification", () => {
  it("distinguishes uuid-shaped entries from synthetic test ids", () => {
    expect(classifyRecoveryEntryId("11111111-1111-4111-8111-111111111111")).toBe("uuid");
    expect(classifyRecoveryEntryId("bad-user")).toBe("synthetic");
  });

  it("counts uuid vs synthetic entries from an isolated journal file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-recovery-classify-"));
    const journal = path.join(tmp, "recovery.jsonl");
    fs.writeFileSync(journal, [
      JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", kind: "user" }),
      JSON.stringify({ id: "bad-user", kind: "user" }),
      JSON.stringify({ id: "good-user", kind: "user" }),
    ].join("\n"));

    const summary = summarizeRecoveryJournal(journal);
    expect(summary.uuidShaped).toBe(1);
    expect(summary.synthetic).toBe(2);
    expect(summary.total).toBe(3);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("composite locators remain correct under normalization", () => {
  it("preserves composite booking_message_reads keys", () => {
    const raw = [
      {
        table: "booking_message_reads",
        phase: "booking_child",
        ownerUserId: "customer-user",
        locator: makeLocatorFromKeys("composite", ["booking_id", "user_id"], [{ booking_id: "b1", user_id: "u1" }]),
      },
      {
        table: "booking_message_reads",
        phase: "booking_child",
        ownerUserId: "provider-user",
        locator: makeLocatorFromKeys("composite", ["booking_id", "user_id"], [{ booking_id: "b1", user_id: "u1" }]),
      },
    ];
    const normalized = normalizePlanDeletions(raw);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].locator.kind).toBe("composite");
    expect(normalized[0].ownerUserIds).toEqual(["customer-user", "provider-user"]);
    expect(normalized[0].coOwned).toBe(true);
  });
});

describe("registry isolation", () => {
  it("does not read the real recovery journal when tests use isolated registry roots", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-registry-root-"));
    configureRegistryRootForTests(tmp);
    fs.writeFileSync(path.join(tmp, "recovery.jsonl"), `${JSON.stringify({ id: "test-user", kind: "user" })}\n`);
    const summary = summarizeRecoveryJournal(path.join(tmp, "recovery.jsonl"));
    expect(summary.total).toBe(1);
    expect(summary.synthetic).toBe(1);
    resetRegistryRootForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
