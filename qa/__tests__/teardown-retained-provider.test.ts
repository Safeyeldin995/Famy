import { describe, expect, it, vi } from "vitest";
import { buildCleanupPlan } from "../teardown-planner.mjs";
import {
  disableRetainedProvider,
  verifyProviderMarketplaceIneligible,
} from "../teardown-retained-provider.mjs";
import { formatTeardownError } from "../teardown-errors.mjs";
import { makeLocatorFromKeys } from "../teardown-row-locators.mjs";

function createRetainedProviderAdmin(state) {
  return {
    from: vi.fn((table) => ({
      select: vi.fn((_cols, opts) => ({
        eq: vi.fn((column, value) => {
          if (table === "providers" && column === "profile_id") {
            return Promise.resolve({
              data: Object.entries(state.providers)
                .filter(([, row]) => row.profile_id === value)
                .map(([id]) => ({ id })),
              error: null,
            });
          }
          if (table === "providers" && column === "id") {
            return {
              maybeSingle: vi.fn(async () => ({
                data: state.providers[value] ?? null,
                error: null,
              })),
            };
          }
          if (table === "bookings" && column === "customer_id") {
            return Promise.resolve({
              data: (state.bookings ?? []).filter((row) => row.customer_id === value).map((row) => ({ id: row.id })),
              error: null,
            });
          }
          if (table === "bookings" && column === "provider_id") {
            return {
              in: vi.fn(async (idColumn, ids) => {
                if (idColumn !== "id") return { data: [], error: null };
                return {
                  data: (state.bookings ?? [])
                    .filter((row) => row.provider_id === value && ids.includes(row.id))
                    .map((row) => ({ id: row.id })),
                  error: null,
                };
              }),
            };
          }
          return {
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            in: vi.fn(async () => ({ data: [], error: null })),
          };
        }),
        in: vi.fn(async (column, ids) => {
          if (table === "booking_cancellations" && column === "booking_id") {
            return {
              data: ids.includes("booking-retained")
                ? [{ id: "cancel-1", booking_id: "booking-retained" }]
                : [],
              error: null,
            };
          }
          if (table === "audit_logs" && column === "booking_id") {
            return { data: [], error: null };
          }
          if (table === "conversations" && column === "booking_id") {
            return { data: [], error: null };
          }
          if (table === "bookings" && column === "provider_id") {
            return {
              data: (state.bookings ?? []).filter((row) => ids.includes(row.provider_id)).map((row) => ({ id: row.id })),
              error: null,
            };
          }
          if (table === "bookings" && column === "id") {
            return {
              data: (state.bookings ?? []).filter((row) => ids.includes(row.id)),
              error: null,
            };
          }
          if (column === "provider_id") {
            return {
              data: ids.flatMap((providerId) => (state.providerChildren?.[table]?.[providerId] ?? [])),
              error: null,
            };
          }
          if (column === "booking_id") {
            return { data: [], error: null };
          }
          return { data: [], error: null };
        }),
        ilike: vi.fn(async () => ({ data: [], error: null })),
      })),
      update: vi.fn((payload) => ({
        eq: vi.fn(async (_column, providerId) => {
          if (table === "providers" && state.providers[providerId]) {
            state.providers[providerId] = { ...state.providers[providerId], ...payload };
          }
          return { error: null };
        }),
      })),
      delete: vi.fn(() => {
        const filters = {};
        const chain = {
          eq(col, val) {
            filters[col] = val;
            return chain;
          },
          then(onFulfilled, onRejected) {
            return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
          },
        };
        return chain;
      }),
    })),
    rpc: vi.fn(async (name, args) => {
      if (name === "provider_marketplace_eligibility") {
        const provider = state.providers[args.p_provider_id];
        return {
          data: provider?.is_active ? [{ is_eligible: true }] : [{ is_eligible: false }],
          error: null,
        };
      }
      return { data: [], error: null };
    }),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: null }, error: null })),
        deleteUser: vi.fn(async () => ({ error: null })),
      },
    },
  };
}

describe("retained provider teardown", () => {
  it("plans provider delete when no immutable booking references remain", async () => {
    const state = {
      bookings: [{ id: "booking-clean", customer_id: "user-provider", provider_id: "provider-clean" }],
      providers: {
        "provider-clean": { id: "provider-clean", profile_id: "user-provider", is_active: true, vacation_mode: false },
      },
      providerChildren: {
        provider_documents: { "provider-clean": [{ id: "doc-1" }] },
      },
    };
    const admin = createRetainedProviderAdmin(state);

    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["user-provider"],
      registryIds: new Set(["user-provider"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: "bfwveoqbyqlhixjvdzha",
    });

    expect(plan.retained.some((row) => row.table === "providers")).toBe(false);
    expect(plan.deletions.some((row) => row.table === "providers")).toBe(true);
  });

  it("retains provider linked to immutable booking history", async () => {
    const state = {
      bookings: [{ id: "booking-retained", customer_id: "user-provider", provider_id: "provider-retained" }],
      providers: {
        "provider-retained": { id: "provider-retained", profile_id: "user-provider", is_active: true, vacation_mode: false },
      },
      providerChildren: {
        provider_documents: { "provider-retained": [{ id: "doc-1" }] },
      },
    };
    const admin = createRetainedProviderAdmin(state);

    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["user-provider"],
      registryIds: new Set(["user-provider"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: "bfwveoqbyqlhixjvdzha",
    });

    expect(plan.retained.some((row) => row.table === "providers" && row.id === "provider-retained")).toBe(true);
    expect(plan.deletions.filter((row) => row.table === "providers")).toHaveLength(0);
  });

  it("does not schedule impossible provider delete for retained booking owner", async () => {
    const state = {
      bookings: [
        { id: "booking-retained", customer_id: "user-a", provider_id: "provider-retained" },
      ],
      providers: {
        "provider-retained": { id: "provider-retained", profile_id: "user-a", is_active: true, vacation_mode: false },
        "provider-other": { id: "provider-other", profile_id: "user-b", is_active: true, vacation_mode: false },
      },
      providerChildren: {
        provider_documents: {
          "provider-retained": [{ id: "doc-1" }],
          "provider-other": [{ id: "doc-2" }],
        },
      },
    };
    const admin = createRetainedProviderAdmin(state);

    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["user-a", "user-b"],
      registryIds: new Set(["user-a", "user-b"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: "bfwveoqbyqlhixjvdzha",
    });

    expect(plan.deletions.some((row) =>
      row.table === "providers" && row.locator.keys.some((key) => key.id === "provider-retained"),
    )).toBe(false);
    expect(plan.deletions.some((row) =>
      row.table === "providers" && row.locator.keys.some((key) => key.id === "provider-other"),
    )).toBe(true);
  });

  it("disables retained provider and verifies marketplace ineligibility", async () => {
    const state = {
      providers: {
        "provider-retained": {
          id: "provider-retained",
          is_active: true,
          vacation_mode: false,
          onboarding_status: "APPROVED",
          is_verified: true,
        },
      },
    };
    const admin = createRetainedProviderAdmin(state);

    await disableRetainedProvider(admin, "provider-retained");
    const check = await verifyProviderMarketplaceIneligible(admin, "provider-retained");
    expect(state.providers["provider-retained"].is_active).toBe(false);
    expect(check.ineligible).toBe(true);
  });

  it("still schedules provider-child cleanup when provider row is retained", async () => {
    const state = {
      bookings: [{ id: "booking-retained", customer_id: "user-provider", provider_id: "provider-retained" }],
      providers: {
        "provider-retained": { id: "provider-retained", profile_id: "user-provider", is_active: true, vacation_mode: false },
      },
      providerChildren: {
        provider_documents: { "provider-retained": [{ id: "doc-1" }] },
      },
    };
    const admin = createRetainedProviderAdmin(state);

    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["user-provider"],
      registryIds: new Set(["user-provider"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: "bfwveoqbyqlhixjvdzha",
    });

    expect(plan.deletions.some((row) => row.table === "provider_documents")).toBe(true);
  });

  it("formats auth.deleteUser errors without empty diagnostics", () => {
    const entry = formatTeardownError({
      operation: "auth.deleteUser",
      entityType: "auth.users",
      id: "58c0d6c0-e990-4908-8240-8392914d2ae3",
      error: {},
    });
    expect(entry.message).toBe("empty-error-object");
    expect(entry.maskedId).toBe("58c0…2ae3");
  });
});

describe("unrelated provider cleanup remains scoped", () => {
  it("keeps unrelated provider delete locators separate", () => {
    const row = {
      table: "providers",
      locator: makeLocatorFromKeys("single", ["id"], [{ id: "provider-other" }]),
      ownerUserIds: ["user-b"],
      phase: "provider",
    };
    expect(row.locator.keys[0].id).toBe("provider-other");
  });
});
