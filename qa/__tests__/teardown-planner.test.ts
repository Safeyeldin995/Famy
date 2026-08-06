import { describe, expect, it, vi } from "vitest";
import {
  BOOKING_CHILD_DELETE_STEPS,
  PROVIDER_DELETE_STEPS,
  USER_SCOPED_DELETE_STEPS,
} from "../teardown-fk-plan.mjs";
import { MIGRATION_PUBLIC_TABLES, validateTeardownTableNames } from "../teardown-fk-contract.mjs";
import { getLocatorContract, TEARDOWN_TABLE_LOCATOR_CONTRACT } from "../teardown-row-locators.mjs";
import {
  assertExecutePlanApproved,
  buildCleanupPlan,
  buildFingerprintPayload,
  computePlanFingerprint,
  planFingerprintsMatch,
  sanitizePlanForReport,
} from "../teardown-planner.mjs";
import { assertExecutePlanApproved as assertFromCore, assessDestructiveCleanupEligibility } from "../teardown-core.mjs";
import { executePlanDeletionSlice } from "../teardown-operations.mjs";
import { makeLocatorFromKeys } from "../teardown-row-locators.mjs";

const PROJECT_REF = "bfwveoqbyqlhixjvdzha";

function createPlannerAdmin(overrides = {}) {
  const bookingsByCustomer = overrides.bookingsByCustomer ?? { "eligible-user": [{ id: "booking-no-notes-1" }, { id: "booking-no-notes-2" }] };
  const bookingsByProvider = overrides.bookingsByProvider ?? [];
  const providersByProfile = overrides.providersByProfile ?? { "eligible-user": [{ id: "provider-1" }] };
  const paymentCounts = overrides.paymentCounts ?? {};
  const promoRedemptions = overrides.promoRedemptions ?? 0;

  return {
    auth: {
      admin: {
        getUserById: vi.fn(async (userId) => ({
          data: {
            user: {
              id: userId,
              email: userId === "eligible-user" ? "qa-fixture@famio.local" : "real.user@example.com",
            },
          },
          error: null,
        })),
        deleteUser: vi.fn(async () => ({ error: null })),
      },
    },
    from: vi.fn((table) => {
      const baseSelect = () => ({
        eq: vi.fn((column, value) => {
          if (table === "profiles" && column === "id") {
            return {
              maybeSingle: vi.fn(async () => ({
                data: { full_name: value === "eligible-user" ? "QA_test" : "Real User" },
                error: null,
              })),
            };
          }
          if (table === "bookings" && column === "customer_id") {
            return Promise.resolve({ data: bookingsByCustomer[value] ?? [], error: null });
          }
          if (table === "providers" && column === "profile_id") {
            return Promise.resolve({ data: providersByProfile[value] ?? [], error: null });
          }
          if (table === "payments" && column === "payment_method_id") {
            return Promise.resolve({ count: paymentCounts[value] ?? 0, error: null });
          }
          if (table === "promo_code_redemptions" && column === "promo_code_id") {
            return Promise.resolve({ count: promoRedemptions, error: null });
          }
          if (table === "services" && column === "service_id") {
            return Promise.resolve({ count: 0, error: null });
          }
          return Promise.resolve({ data: [], count: 0, error: null });
        }),
        in: vi.fn(async (column, values) => {
          if (table === "bookings" && column === "provider_id") {
            return { data: bookingsByProvider, error: null };
          }
          return { data: [], error: null };
        }),
        ilike: vi.fn(async () => ({ data: [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      });

      return {
        select: vi.fn((_cols, opts) => {
          if (opts?.count === "exact" && opts?.head) {
            return baseSelect();
          }
          return baseSelect();
        }),
        delete: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
          in: vi.fn(async () => ({ error: null })),
        })),
      };
    }),
  };
}

describe("teardown locator contracts", () => {
  it("maps non-id and composite primary keys from migrations", () => {
    expect(getLocatorContract("booking_locations").keyColumns).toEqual(["booking_id"]);
    expect(getLocatorContract("booking_family_member_snapshots").keyColumns).toEqual(["booking_id"]);
    expect(getLocatorContract("provider_onboarding_details").keyColumns).toEqual(["provider_id"]);
    expect(getLocatorContract("provider_admin_internal_notes").keyColumns).toEqual(["provider_id"]);
    expect(getLocatorContract("booking_message_reads").kind).toBe("composite");
    expect(getLocatorContract("payments").keyColumns).toEqual(["id"]);
  });

  it("selects booking_id for booking_locations during plan building", async () => {
    const selects = [];
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async (userId) => ({
            data: { user: { id: userId, email: "qa-fixture@famio.local" } },
            error: null,
          })),
        },
      },
      from: vi.fn((table) => ({
        select: vi.fn((cols) => {
          selects.push({ table, cols });
          return {
            eq: vi.fn(async () => ({
              data: table === "bookings" ? [{ id: "booking-1" }] : [],
              error: null,
            })),
            in: vi.fn(async () => ({
              data: table === "booking_locations"
                ? [{ booking_id: "booking-1" }]
                : table === "booking_family_member_snapshots"
                  ? [{ booking_id: "booking-1" }]
                  : table === "booking_message_reads"
                    ? [{ booking_id: "booking-1", user_id: "user-1" }]
                    : [],
              error: null,
            })),
            ilike: vi.fn(async () => ({ data: [], error: null })),
          };
        }),
        delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })), in: vi.fn(async () => ({ error: null })) })),
      })),
    };

    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["eligible-user"],
      registryIds: new Set(["eligible-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    expect(selects.some((row) => row.table === "booking_locations" && row.cols === "booking_id")).toBe(true);
    expect(selects.some((row) => row.table === "booking_family_member_snapshots" && row.cols === "booking_id")).toBe(true);
    expect(selects.some((row) => row.table === "booking_message_reads" && row.cols === "booking_id,user_id")).toBe(true);
    expect(selects.some((row) => row.table === "booking_message_reads" && row.cols === "id")).toBe(false);

    const locations = plan.deletions.find((row) => row.table === "booking_locations");
    expect(locations?.locator.keys).toEqual([{ booking_id: "booking-1" }]);
  });
});

describe("teardown FK contract", () => {
  it("fails when teardown references a nonexistent table name", () => {
    const result = validateTeardownTableNames(["bookings", "not_a_real_table"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("not_a_real_table");
    }
  });

  it("validates all booking/provider/user teardown tables exist in migrations", () => {
    const tables = [
      ...BOOKING_CHILD_DELETE_STEPS.map((step) => step.table).filter(Boolean),
      ...PROVIDER_DELETE_STEPS.map((step) => step.table),
      ...USER_SCOPED_DELETE_STEPS.map((step) => step.table).filter(Boolean),
      "bookings",
      "providers",
      "profiles",
      "ticket_messages",
    ];
    const result = validateTeardownTableNames(tables);
    expect(result.ok).toBe(true);
    expect(MIGRATION_PUBLIC_TABLES.has("booking_family_member_snapshots")).toBe(true);
    expect(MIGRATION_PUBLIC_TABLES.has("provider_admin_internal_notes")).toBe(true);
    expect(MIGRATION_PUBLIC_TABLES.has("provider_requirement_fulfillments")).toBe(true);
    expect(MIGRATION_PUBLIC_TABLES.has("provider_internal_notes")).toBe(false);
  });

  it("orders ticket_messages before support_tickets in user scoped steps", () => {
    const tables = USER_SCOPED_DELETE_STEPS.map((step) => step.table ?? "ticket_messages");
    expect(tables.indexOf("ticket_messages")).toBeLessThan(tables.indexOf("support_tickets"));
  });

  it("does not include audit_logs in booking child delete steps", () => {
    expect(BOOKING_CHILD_DELETE_STEPS.some((step) => step.table === "audit_logs")).toBe(false);
  });

  it("has explicit locator for every teardown table in contract", () => {
    const tables = [
      ...BOOKING_CHILD_DELETE_STEPS.map((s) => s.table).filter(Boolean),
      ...PROVIDER_DELETE_STEPS.map((s) => s.table),
      ...USER_SCOPED_DELETE_STEPS.map((s) => s.table).filter(Boolean),
      "bookings",
      "providers",
      "profiles",
      "auth.users",
    ];
    for (const table of tables) {
      expect(TEARDOWN_TABLE_LOCATOR_CONTRACT[table]).toBeDefined();
    }
  });
});

describe("cleanup planner", () => {
  it("includes owned bookings without QA notes in dry-run plan counts", async () => {
    const admin = createPlannerAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["eligible-user", "ineligible-user"],
      registryIds: new Set(["eligible-user", "ineligible-user"]),
      assessEligibility: assessDestructiveCleanupEligibility,
      projectRef: PROJECT_REF,
    });

    expect(plan.counts.eligible_users).toBe(1);
    expect(plan.counts.refused_users).toBe(1);
    expect(plan.counts.owned_bookings).toBe(2);
    expect(plan.refusedUsers[0].userId).toBe("ineligible-user");
  });

  it("assigns zero planned rows to ineligible owners", async () => {
    const admin = createPlannerAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["ineligible-user"],
      registryIds: new Set(["ineligible-user"]),
      assessEligibility: assessDestructiveCleanupEligibility,
      projectRef: PROJECT_REF,
    });

    expect(plan.eligibleUsers).toHaveLength(0);
    expect(plan.deletions.filter((row) => row.ownerUserId === "ineligible-user")).toHaveLength(0);
  });

  it("produces identical fingerprints for identical plans", async () => {
    const admin = createPlannerAdmin();
    const input = {
      admin,
      candidateUserIds: ["eligible-user"],
      registryIds: new Set(["eligible-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    };
    const left = await buildCleanupPlan(input);
    const right = await buildCleanupPlan(input);
    expect(planFingerprintsMatch(left, right)).toBe(true);
  });

  it("fingerprint contains no emails or full UUIDs in sanitized report", async () => {
    const admin = createPlannerAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["11111111-1111-4111-8111-111111111111"],
      registryIds: new Set(["11111111-1111-4111-8111-111111111111"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });
    admin.auth.admin.getUserById = vi.fn(async () => ({
      data: { user: { id: "11111111-1111-4111-8111-111111111111", email: "qa-fixture@famio.local" } },
      error: null,
    }));

    const sanitized = sanitizePlanForReport(plan);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("qa-fixture@famio.local");
    expect(serialized).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(sanitized.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("blocks execute when plan fingerprint mismatches", async () => {
    const admin = createPlannerAdmin();
    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["eligible-user"],
      registryIds: new Set(["eligible-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    expect(() => assertExecutePlanApproved(plan, "deadbeef")).toThrow(/fingerprint mismatch/i);
    expect(() => assertFromCore(plan, undefined)).toThrow(/requires --plan-fingerprint/i);
  });

  it("retains generic QA resources when references remain", async () => {
    const admin = createPlannerAdmin({ paymentCounts: { "pm-qa-1": 2 } });
    admin.from = vi.fn((table) => {
      if (table === "payment_methods") {
        return {
          select: vi.fn(() => ({
            ilike: vi.fn(async () => ({
              data: [{ id: "pm-qa-1", name_en: "QA_test_method" }],
              error: null,
            })),
          })),
        };
      }
      if (table === "payments") {
        return {
          select: vi.fn((_cols, opts) => ({
            eq: vi.fn(async (_column, value) => ({
              count: value === "pm-qa-1" ? 2 : 0,
              error: null,
            })),
          })),
        };
      }
      return createPlannerAdmin().from(table);
    });

    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: [],
      registryIds: new Set(),
      assessEligibility: async () => ({ eligible: false, reason: "insufficient-qa-signals" }),
      projectRef: PROJECT_REF,
    });

    expect(plan.deletions.some((row) => row.table === "payment_methods")).toBe(false);
    expect(plan.retained.some((row) => row.table === "payment_methods")).toBe(true);
  });

  it("dry-run and execute paths share the same plan builder counts", async () => {
    const admin = createPlannerAdmin();
    const buildInput = {
      admin,
      candidateUserIds: ["eligible-user"],
      registryIds: new Set(["eligible-user"]),
      assessEligibility: assessDestructiveCleanupEligibility,
      projectRef: PROJECT_REF,
    };
    const dryPlan = await buildCleanupPlan(buildInput);
    const executePlan = await buildCleanupPlan(buildInput);
    expect(computePlanFingerprint(dryPlan)).toBe(computePlanFingerprint(executePlan));
    expect(dryPlan.counts.owned_bookings).toBe(executePlan.counts.owned_bookings);
  });

  it("execute stops before mutation when rebuilt plan differs", async () => {
    const admin = createPlannerAdmin();
    const original = await buildCleanupPlan({
      admin,
      candidateUserIds: ["eligible-user"],
      registryIds: new Set(["eligible-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    const changedAdmin = createPlannerAdmin({
      bookingsByCustomer: { "eligible-user": [{ id: "booking-no-notes-1" }, { id: "booking-no-notes-2" }, { id: "booking-new" }] },
    });
    const changed = await buildCleanupPlan({
      admin: changedAdmin,
      candidateUserIds: ["eligible-user"],
      registryIds: new Set(["eligible-user"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: PROJECT_REF,
    });

    expect(buildFingerprintPayload(original).deletions).not.toEqual(buildFingerprintPayload(changed).deletions);
    expect(() => assertExecutePlanApproved(changed, original.fingerprint)).toThrow(/fingerprint mismatch/i);
  });
});

describe("executePlanDeletionSlice", () => {
  it("does not delete audit_logs rows and skips identity tables in safe slice", async () => {
    const calls = [];
    const admin = {
      auth: { admin: { deleteUser: vi.fn(async () => ({ error: null })) } },
      from: vi.fn((table) => ({
        delete: vi.fn(() => ({
          eq: vi.fn(async () => {
            calls.push(table);
            return { error: null };
          }),
          in: vi.fn(async () => ({ error: null })),
        })),
      })),
    };

    await executePlanDeletionSlice(admin, [
      { table: "payments", locator: makeLocatorFromKeys("single", ["id"], [{ id: "pay-1" }]), phase: "booking_child" },
      { table: "bookings", locator: makeLocatorFromKeys("single", ["id"], [{ id: "booking-1" }]), phase: "booking" },
      { table: "profiles", locator: makeLocatorFromKeys("single", ["id"], [{ id: "user-1" }]), phase: "user_identity_profile" },
      { table: "auth.users", locator: makeLocatorFromKeys("single", ["id"], [{ id: "user-1" }]), phase: "user_identity_auth" },
    ]);

    expect(calls).not.toContain("audit_logs");
    expect(calls).not.toContain("profiles");
    expect(calls.indexOf("payments")).toBeLessThan(calls.indexOf("bookings"));
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
});
