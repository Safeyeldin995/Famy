import { describe, expect, it, vi } from "vitest";
import {
  BOOKING_CHILD_DELETE_STEPS,
  PROVIDER_DELETE_STEPS,
  discoverOwnedBookingIds,
  isProtectedSeededCatalogRow,
  isQaTaggedName,
} from "../teardown-fk-plan.mjs";
import { formatTeardownError } from "../teardown-errors.mjs";
import {
  deleteBookingChildren,
  deleteProviderDeep,
} from "../teardown-operations.mjs";
import { verifyUserFullyRemoved } from "../teardown-verification.mjs";
import { buildCleanupPlan } from "../teardown-planner.mjs";
import { runTeardownForUserIds, assessDestructiveCleanupEligibility } from "../teardown-core.mjs";
import {
  readRegistry,
  registerUserEntry,
  removeRegistryUsers,
  recordRecoveryFailure,
} from "../registry.mjs";
import { useIsolatedRegistry } from "./registry-test-harness.ts";

function createDeleteTracker() {
  const calls = [];
  const tables = new Map();

  function tableApi(table) {
    if (!tables.has(table)) {
      tables.set(table, {
        selectRows: [],
        deleteErrors: {},
        deleteDelay: {},
      });
    }
    return tables.get(table);
  }

  const admin = {
    auth: {
      admin: {
        getUserById: vi.fn(async (userId) => ({
          data: { user: { id: userId, email: "qa-user@famio.local", deleted_at: null } },
          error: null,
        })),
        deleteUser: vi.fn(async () => ({ error: null })),
      },
    },
    from: vi.fn((table) => {
      const state = tableApi(table);
      return {
        select: vi.fn((_cols, opts) => {
          const chain = {
            eq: vi.fn((column, value) => {
              if (opts?.count === "exact" && opts?.head) {
                const key = `${table}:${column}:${value}`;
                const count = state.counts?.[key] ?? 0;
                return Promise.resolve({ count, error: null });
              }
              return {
                maybeSingle: vi.fn(async () => ({ data: state.maybeSingle ?? null, error: null })),
                single: vi.fn(async () => ({ data: state.single ?? null, error: null })),
                in: vi.fn(async () => ({ data: state.selectRows, error: null })),
                then: undefined,
              };
            }),
            in: vi.fn(async () => ({ data: state.selectRows, error: null })),
            ilike: vi.fn(() => ({
              then: undefined,
              data: state.selectRows,
              error: null,
            })),
            not: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: state.selectRows, error: null })),
            })),
          };
          return chain;
        }),
        delete: vi.fn(() => ({
          eq: vi.fn(async (_column, value) => {
            calls.push({ op: "delete", table, value });
            const err = state.deleteErrors[value] ?? state.deleteErrors["*"];
            return { error: err ?? null };
          }),
          in: vi.fn(async (_column, values) => {
            calls.push({ op: "delete", table, values });
            return { error: state.deleteErrors["*"] ?? null };
          }),
        })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(async () => ({ data: {}, error: null })) })) })),
      };
    }),
    _calls: calls,
    _state: tables,
  };

  return admin;
}

describe("teardown FK plan", () => {
  it("discovers bookings by customer and provider ownership without notes filter", async () => {
    const admin = {
      from: vi.fn((table) => ({
        select: vi.fn(() => ({
          eq: vi.fn((column, value) => {
            if (table === "bookings" && column === "customer_id") {
              return Promise.resolve({ data: [{ id: "booking-customer" }], error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
          in: vi.fn(async () => ({ data: [{ id: "booking-provider" }], error: null })),
        })),
      })),
    };

    const ids = await discoverOwnedBookingIds(admin, "user-1", ["provider-1"]);
    expect(ids.sort()).toEqual(["booking-customer", "booking-provider"]);
  });

  it("does not include audit_logs in booking child delete steps", () => {
    expect(BOOKING_CHILD_DELETE_STEPS.some((step) => step.table === "audit_logs")).toBe(false);
  });

  it("orders booking_status_history and payments before bookings table step", () => {
    const tables = BOOKING_CHILD_DELETE_STEPS.map((step) => step.table).filter(Boolean);
    expect(tables.indexOf("booking_status_history")).toBeLessThan(tables.indexOf("notifications"));
    expect(tables.indexOf("payments")).toBeGreaterThan(-1);
  });

  it("orders provider onboarding tables before providers row", () => {
    const tables = PROVIDER_DELETE_STEPS.map((step) => step.table);
    expect(tables.indexOf("provider_onboarding_details")).toBeLessThan(tables.length);
    expect(tables.at(-1)).not.toBe("providers");
  });

  it("protects non-QA names from QA service deletion", () => {
    expect(isProtectedSeededCatalogRow({ name_en: "Home Cleaning", slug: "home-cleaning" })).toBe(true);
    expect(isProtectedSeededCatalogRow({ name_en: "QA Booking Service", slug: "qa-booking" })).toBe(false);
    expect(isQaTaggedName("QA Booking Zone")).toBe(true);
  });
});

describe("teardown operations ordering", () => {
  it("deletes booking children before booking row", async () => {
    const order = [];
    const admin = {
      from: vi.fn((table) => ({
        select: vi.fn(() => ({
          eq: vi.fn(async () => {
            if (table === "notifications") return { data: [{ id: "n1" }], error: null };
            if (table === "conversations") return { data: [], error: null };
            return { data: [], error: null };
          }),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(async () => {
            order.push(table);
            return { error: null };
          }),
          in: vi.fn(async () => {
            order.push(table);
            return { error: null };
          }),
        })),
      })),
    };

    await deleteBookingChildren(admin, "booking-1");
    expect(order.indexOf("booking_status_history")).toBeGreaterThan(-1);
    expect(order.indexOf("bookings")).toBe(-1);

    await admin.from("bookings").delete().eq("id", "booking-1");
    expect(order.at(-1)).toBe("bookings");
  });

  it("reports provider delete failure without false success", async () => {
    const admin = createDeleteTracker();
    admin.from("providers");
    admin._state.get("providers").deleteErrors["*"] = { message: "fk violation", code: "23503" };
    admin.from("providers").select = vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: { id: "provider-1" }, error: null })),
      })),
    }));

    const result = await deleteProviderDeep(admin, "provider-1");
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain("fk violation");
  });
});

describe("runTeardownForUserIds eligibility and honesty", () => {
  useIsolatedRegistry();

  it("performs zero mutations for ineligible candidates", async () => {
    const admin = createDeleteTracker();
    admin.auth.admin.getUserById = vi.fn(async () => ({
      data: { user: { email: "real.user@example.com" } },
      error: null,
    }));

    const result = await runTeardownForUserIds(admin, ["bad-user"], {
      execute: true,
      registryIds: ["bad-user"],
    });

    expect(result.refused).toHaveLength(1);
    expect(result.succeeded).toHaveLength(0);
    expect(admin._calls.filter((c) => c.op === "delete")).toHaveLength(0);
  });

  it("assesses eligibility before first delete call", async () => {
    const admin = createDeleteTracker();
    let eligibilityChecked = false;

    admin.auth.admin.getUserById = vi.fn(async (userId) => {
      eligibilityChecked = true;
      return { data: { user: { id: userId, email: "qa-fixture@famio.local" } }, error: null };
    });

    const baseFrom = admin.from;
    admin.from = vi.fn((table) => {
      const api = createDeleteTracker().from(table);
      if (table === "bookings") {
        api.select = vi.fn(() => ({
          eq: vi.fn(async () => {
            expect(eligibilityChecked).toBe(true);
            return { data: [], error: null };
          }),
          in: vi.fn(async () => ({ data: [], error: null })),
        }));
      }
      if (table === "profiles") {
        api.select = vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { full_name: "QA_test" }, error: null })),
          })),
        }));
      }
      return api;
    });

    await runTeardownForUserIds(admin, ["good-user"], { execute: true, registryIds: [] });
  });

  it("classifies FK failure as failed/retained not succeeded", async () => {
    const admin = createDeleteTracker();
    admin.auth.admin.getUserById = vi.fn(async (userId) => ({
      data: { user: { id: userId, email: "qa-fixture@famio.local" } },
      error: null,
    }));

    admin.from = vi.fn((table) => {
      const api = createDeleteTracker().from(table);
      if (table === "profiles") {
        api.select = vi.fn(() => ({
          eq: vi.fn((_column, value) => ({
            maybeSingle: vi.fn(async () => ({ data: value === "good-user" ? { id: value } : null, error: null })),
            in: vi.fn(async () => ({ data: [], error: null })),
          })),
          in: vi.fn(async () => ({ data: [], error: null })),
        }));
      }
      if (table === "bookings") {
        api.select = vi.fn(() => ({
          eq: vi.fn(async () => ({ data: [{ id: "booking-1" }], error: null })),
          in: vi.fn(async () => ({ data: [], error: null })),
        }));
        api.delete = vi.fn(() => ({
          eq: vi.fn(async () => {
            admin._calls.push({ op: "delete", table: "bookings" });
            return { error: { message: "fk blocked", code: "23503" } };
          }),
          in: vi.fn(async () => ({ error: null })),
        }));
      }
      return api;
    });

    const result = await runTeardownForUserIds(admin, ["good-user"], { execute: true, registryIds: [] });
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed.length + result.retained.length).toBeGreaterThan(0);
  });
});

describe("registry and recovery honesty", () => {
  useIsolatedRegistry();

  it("records recovery for refused IDs and removes only succeeded IDs from registry", async () => {
    registerUserEntry({ userId: "good-user", email: "qa-good@famio.local" });
    registerUserEntry({ userId: "bad-user", email: "qa-bad@famio.local" });

    const result = await runTeardownForUserIds(
      {
        auth: {
          admin: {
            getUserById: vi.fn(async (userId) => ({
              data: {
                user: {
                  id: userId,
                  email: userId === "good-user" ? "qa-good@famio.local" : "real.user@example.com",
                },
              },
              error: null,
            })),
            deleteUser: vi.fn(async () => ({ error: null })),
          },
        },
        from: vi.fn((table) => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: table === "profiles" ? { full_name: "QA_test" } : null,
                error: null,
              })),
              in: vi.fn(async () => ({ data: [], error: null })),
            })),
            in: vi.fn(async () => ({ data: [], error: null })),
            ilike: vi.fn(async () => ({ data: [], error: null })),
          })),
          delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })), in: vi.fn(async () => ({ error: null })) })),
        })),
      },
      ["good-user", "bad-user"],
      { execute: false, registryIds: ["good-user", "bad-user"] },
    );

    if (result.succeeded.length) removeRegistryUsers(result.succeeded);
    for (const row of result.refused) {
      recordRecoveryFailure({ id: row.userId, kind: "user", reason: row.reason });
    }

    const reg = readRegistry();
    expect(result.succeeded).toEqual(["good-user"]);
    expect(result.refused.map((r) => r.userId)).toEqual(["bad-user"]);
    expect(reg.users.some((u) => u.userId === "bad-user")).toBe(true);
    expect(reg.users.some((u) => u.userId === "good-user")).toBe(false);
    expect((reg.recovery ?? []).some((entry) => entry.id === "bad-user")).toBe(true);
  });
});

describe("QA service cleanup via planner", () => {
  function createPlannerAdmin(serviceRows = []) {
    return {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({ data: { user: null }, error: null })),
        },
      },
      from: vi.fn((table) => ({
        select: vi.fn((_cols, opts) => {
          if (table === "services") {
            return {
              ilike: vi.fn(async () => ({ data: serviceRows, error: null })),
            };
          }
          if (opts?.count === "exact" && opts?.head) {
            return {
              eq: vi.fn(async () => ({
                count: table === "bookings" && serviceRows.length ? 1 : 0,
                error: null,
              })),
            };
          }
          return {
            eq: vi.fn(async () => ({ data: [], error: null })),
            ilike: vi.fn(async () => ({ data: [], error: null })),
            in: vi.fn(async () => ({ data: [], error: null })),
          };
        }),
        delete: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
          in: vi.fn(async () => ({ error: null })),
        })),
      })),
    };
  }

  it("reports retained service when delete would fail reference checks", async () => {
    const admin = createPlannerAdmin([{ id: "svc-1", name_en: "QA Booking Service", slug: "qa-test" }]);

    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: [],
      registryIds: new Set(),
      assessEligibility: async () => ({ eligible: false, reason: "insufficient-qa-signals" }),
      projectRef: "local-test",
    });
    expect(plan.deletions.some((row) => row.table === "services")).toBe(false);
    expect(plan.retained.some((row) => row.table === "services")).toBe(true);
  });

  it("never plans deletion for seeded catalog services lacking QA_ prefix", async () => {
    const admin = createPlannerAdmin([{ id: "seed-1", name_en: "Home Cleaning", slug: "home-cleaning" }]);

    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: [],
      registryIds: new Set(),
      assessEligibility: async () => ({ eligible: false, reason: "insufficient-qa-signals" }),
      projectRef: "local-test",
    });
    expect(plan.deletions.some((row) => row.table === "services")).toBe(false);
    expect(plan.retained[0]?.reason).toBe("protected-non-qa-name");
    expect(isProtectedSeededCatalogRow({ name_en: "Home Cleaning", slug: "home-cleaning" })).toBe(true);
  });
});

describe("sanitized error format", () => {
  it("never includes full UUID or email in formatted output", () => {
    const formatted = formatTeardownError({
      operation: "delete",
      table: "bookings",
      id: "12345678-abcd-4000-8000-123456789abc",
      error: { message: "fk violation", code: "23503" },
    });
    expect(formatted.maskedId).toBe("1234…9abc");
    expect(JSON.stringify(formatted)).not.toContain("12345678-abcd-4000-8000-123456789abc");
  });
});

describe("assessDestructiveCleanupEligibility parity", () => {
  it("rejects registry-only real-looking users before mutations", async () => {
    const admin = {
      auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: "real@example.com" } } })) } },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { full_name: "QA_ Person" } })),
          })),
        })),
      })),
    };

    const result = await assessDestructiveCleanupEligibility(admin, "user-x", new Set(["user-x"]));
    expect(result.eligible).toBe(false);
  });
});
