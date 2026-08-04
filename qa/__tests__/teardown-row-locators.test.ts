import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  TEARDOWN_TABLE_LOCATOR_CONTRACT,
  canonicalizeLocator,
  discoverScopedLocatorKeys,
  executeLocatorDeletion,
  getLocatorContract,
  makeLocatorFromKeys,
  makeRootLocator,
} from "../teardown-row-locators.mjs";
import {
  BOOKING_CHILD_DELETE_STEPS,
  PROVIDER_DELETE_STEPS,
  USER_SCOPED_DELETE_STEPS,
  QA_TAGGED_RESOURCE_DEFS,
} from "../teardown-fk-plan.mjs";
import {
  MIGRATION_TABLE_KEY_COLUMNS,
  assertTeardownLocatorCoverage,
} from "../teardown-fk-contract.mjs";
import {
  buildCleanupPlan,
  buildFingerprintPayload,
  computePlanFingerprint,
} from "../teardown-planner.mjs";
import { executePlanDeletionSlice } from "../teardown-operations.mjs";

const COLUMN_42703 = { message: "column does not exist", code: "42703" };

/** Schema-faithful mock: select on unknown columns returns PostgreSQL 42703. */
function createSchemaMock(tableData = {}) {
  const deleted = [];

  function buildDelete(table, rows) {
    /** @type {Record<string, string>} */
    let filters = {};
    const chain = {
      eq(col, val) {
        filters[col] = String(val);
        return chain;
      },
      then(onFulfilled, onRejected) {
        const matchIdx = rows.findIndex((row) =>
          Object.entries(filters).every(([k, v]) => String(row[k]) === v),
        );
        if (matchIdx >= 0) {
          deleted.push({ table, filters: { ...filters } });
          rows.splice(matchIdx, 1);
        }
        return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  const admin = {
    from: vi.fn((table) => {
      const rows = tableData[table] ?? [];
      const knownColumns = new Set(
        rows.length
          ? Object.keys(rows[0])
          : (MIGRATION_TABLE_KEY_COLUMNS[table] ?? ["id"]),
      );

      return {
        select: vi.fn((cols) => {
          const requested = cols.split(",").map((c) => c.trim());
          const missing = requested.filter((col) => !knownColumns.has(col));
          if (missing.length) {
            const err = { ...COLUMN_42703, message: `column ${table}.${missing[0]} does not exist` };
            return {
              in: vi.fn(async () => ({ data: null, error: err })),
              eq: vi.fn(async () => ({ data: null, error: err })),
            };
          }

          const project = (list) => list.map((row) => {
            /** @type {Record<string, string>} */
            const out = {};
            for (const col of requested) if (col in row) out[col] = String(row[col]);
            return out;
          });

          return {
            in: vi.fn((_scopeCol, values) => {
              const filtered = rows.filter((row) => values.includes(String(row[_scopeCol])));
              return Promise.resolve({ data: project(filtered), error: null });
            }),
            eq: vi.fn((_scopeCol, value) => {
              const filtered = rows.filter((row) => String(row[_scopeCol]) === String(value));
              return Promise.resolve({ data: project(filtered), error: null });
            }),
          };
        }),
        delete: vi.fn(() => buildDelete(table, rows)),
      };
    }),
    _deleted: deleted,
    _data: tableData,
  };

  return admin;
}

describe("teardown row locator contracts", () => {
  const allTables = [
    ...BOOKING_CHILD_DELETE_STEPS.map((s) => s.table).filter(Boolean),
    ...PROVIDER_DELETE_STEPS.map((s) => s.table),
    ...USER_SCOPED_DELETE_STEPS.map((s) => s.table).filter(Boolean),
    ...QA_TAGGED_RESOURCE_DEFS.map((d) => d.table),
    "bookings",
    "providers",
    "profiles",
    "auth.users",
    "services",
    "zones",
    "zone_services",
    "service_requirements",
  ];

  it("covers every current teardown table with explicit locator", () => {
    expect(() => assertTeardownLocatorCoverage(allTables)).not.toThrow();
  });

  it("marks immutable tables and composite PK correctly", () => {
    expect(getLocatorContract("booking_message_reads")).toEqual({
      kind: "composite",
      keyColumns: ["booking_id", "user_id"],
      discoveryScopeColumn: "booking_id",
    });
    expect(getLocatorContract("ticket_messages").kind).toBe("immutable");
    expect(getLocatorContract("audit_logs").kind).toBe("immutable");
    expect(getLocatorContract("booking_cancellations").kind).toBe("immutable");
    expect(getLocatorContract("messages").kind).toBe("immutable");
  });
});

describe("booking_message_reads composite PK", () => {
  it("discovers booking_id and user_id without selecting id", async () => {
    const admin = createSchemaMock({
      booking_message_reads: [
        { booking_id: "b1", user_id: "u1" },
        { booking_id: "b1", user_id: "u2" },
        { booking_id: "b2", user_id: "u9" },
      ],
    });

    const locator = await discoverScopedLocatorKeys(admin, "booking_message_reads", "booking_id", ["b1"]);
    expect(locator.kind).toBe("composite");
    expect(locator.columns).toEqual(["booking_id", "user_id"]);
    expect(locator.keys).toEqual([
      { booking_id: "b1", user_id: "u1" },
      { booking_id: "b1", user_id: "u2" },
    ]);
    expect(admin.from).toHaveBeenCalledWith("booking_message_reads");
  });

  it("returns 42703 when selecting nonexistent id column", async () => {
    const admin = createSchemaMock({ booking_message_reads: [{ booking_id: "b1", user_id: "u1" }] });
    const result = await admin.from("booking_message_reads").select("id").in("booking_id", ["b1"]);
    expect(result.error?.code).toBe("42703");
  });

  it("executes exact composite-key deletion", async () => {
    const admin = createSchemaMock({
      booking_message_reads: [
        { booking_id: "b1", user_id: "u1" },
        { booking_id: "b1", user_id: "u2" },
        { booking_id: "b2", user_id: "u9" },
      ],
    });
    const locator = makeLocatorFromKeys("composite", ["booking_id", "user_id"], [
      { booking_id: "b1", user_id: "u1" },
    ]);
    const errors = [];
    await executeLocatorDeletion(admin, "booking_message_reads", locator, errors);
    expect(errors).toHaveLength(0);
    expect(admin._deleted).toEqual([{ table: "booking_message_reads", filters: { booking_id: "b1", user_id: "u1" } }]);
    expect(admin._data.booking_message_reads).toHaveLength(2);
  });

  it("leaves unrelated message-read rows untouched", async () => {
    const admin = createSchemaMock({
      booking_message_reads: [
        { booking_id: "b1", user_id: "u1" },
        { booking_id: "b2", user_id: "u9" },
      ],
    });
    const locator = makeLocatorFromKeys("composite", ["booking_id", "user_id"], [
      { booking_id: "b1", user_id: "u1" },
    ]);
    await executeLocatorDeletion(admin, "booking_message_reads", locator, []);
    expect(admin._data.booking_message_reads.some((r) => r.booking_id === "b2")).toBe(true);
  });
});

describe("non-id single-key locators", () => {
  it.each([
    ["booking_locations", "booking_id", "b1"],
    ["booking_family_member_snapshots", "booking_id", "b1"],
    ["provider_onboarding_details", "provider_id", "p1"],
    ["provider_admin_internal_notes", "provider_id", "p1"],
    ["ratings_summary", "provider_id", "p1"],
    ["trust_scores", "provider_id", "p1"],
  ])("%s discovers %s keys", async (table, keyColumn, value) => {
    const row = { [keyColumn]: value };
    const admin = createSchemaMock({ [table]: [row] });
    const locator = await discoverScopedLocatorKeys(admin, table, keyColumn, [value]);
    expect(locator.kind).toBe("single");
    expect(locator.columns).toEqual([keyColumn]);
    expect(locator.keys).toEqual([row]);
  });
});

describe("normal id-keyed table", () => {
  it("discovers payments by booking_id scope with id keys", async () => {
    const admin = createSchemaMock({
      payments: [{ id: "pay-1", booking_id: "b1" }],
    });
    const locator = await discoverScopedLocatorKeys(admin, "payments", "booking_id", ["b1"]);
    expect(locator.columns).toEqual(["id"]);
    expect(locator.keys).toEqual([{ id: "pay-1" }]);
  });
});

describe("mixed plan and fingerprint parity", () => {
  it("builds mixed booking/provider/user plan with locators", async () => {
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async (userId) => ({
            data: { user: { id: userId, email: "qa-fixture@famio.local" } },
            error: null,
          })),
        },
      },
      from: vi.fn((table) => {
        if (table === "profiles") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: { full_name: "QA_test" }, error: null })),
              })),
            })),
          };
        }
        if (table === "providers") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [{ id: "p1" }], error: null })),
            })),
          };
        }
        if (table === "bookings") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [{ id: "b1" }], error: null })),
              in: vi.fn(async () => ({ data: [], error: null })),
            })),
          };
        }
        if (table === "booking_message_reads") {
          return {
            select: vi.fn((cols) => ({
              in: vi.fn(async () => ({
                data: cols === "booking_id,user_id" ? [{ booking_id: "b1", user_id: "u1" }] : null,
                error: cols === "id" ? { code: "42703", message: "column booking_message_reads.id does not exist" } : null,
              })),
            })),
          };
        }
        if (table === "booking_locations") {
          return {
            select: vi.fn((cols) => ({
              in: vi.fn(async () => ({
                data: cols === "booking_id" ? [{ booking_id: "b1" }] : null,
                error: null,
              })),
            })),
          };
        }
        if (table === "provider_onboarding_details") {
          return {
            select: vi.fn((cols) => ({
              in: vi.fn(async () => ({
                data: cols === "provider_id" ? [{ provider_id: "p1" }] : null,
                error: null,
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: [], error: null })),
            in: vi.fn(async () => ({ data: [], error: null })),
            ilike: vi.fn(async () => ({ data: [], error: null })),
          })),
          delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })), in: vi.fn(async () => ({ error: null })) })),
        };
      }),
    };

    const plan = await buildCleanupPlan({
      admin,
      candidateUserIds: ["u1"],
      registryIds: new Set(["u1"]),
      assessEligibility: async () => ({ eligible: true, reason: "eligible" }),
      projectRef: "local-test",
    });

    const reads = plan.deletions.find((d) => d.table === "booking_message_reads");
    expect(reads?.locator.kind).toBe("composite");
    expect(reads?.locator.keys).toEqual([{ booking_id: "b1", user_id: "u1" }]);
    expect(plan.deletions.every((d) => d.locator)).toBe(true);
  });

  it("fingerprint includes composite tuples and locator metadata", async () => {
    const plan = {
      version: "6a.2-planner-v4",
      projectRef: "local-test",
      eligibleUsers: [{ userId: "u1", maskedId: "u1…u1" }],
      refusedUsers: [],
      deletions: [{
        table: "booking_message_reads",
        ownerUserIds: ["u1"],
        coOwned: false,
        phase: "booking_child",
        locator: makeLocatorFromKeys("composite", ["booking_id", "user_id"], [
          { booking_id: "b2", user_id: "u9" },
          { booking_id: "b1", user_id: "u1" },
        ]),
      }],
      retained: [],
    };

    const payload = buildFingerprintPayload(plan);
    expect(payload.deletions[0].locator.kind).toBe("composite");
    expect(payload.deletions[0].locator.columns).toEqual(["booking_id", "user_id"]);
    expect(payload.deletions[0].locator.keys).toEqual([
      { booking_id: "b1", user_id: "u1" },
      { booking_id: "b2", user_id: "u9" },
    ]);

    const reordered = {
      ...plan,
      deletions: [{
        ...plan.deletions[0],
        locator: makeLocatorFromKeys("composite", ["booking_id", "user_id"], [
          { booking_id: "b1", user_id: "u1" },
          { booking_id: "b2", user_id: "u9" },
        ]),
      }],
    };
    expect(computePlanFingerprint(plan)).toBe(computePlanFingerprint(reordered));

    const changedTuple = {
      ...plan,
      deletions: [{
        ...plan.deletions[0],
        locator: makeLocatorFromKeys("composite", ["booking_id", "user_id"], [
          { booking_id: "b1", user_id: "u1" },
          { booking_id: "b2", user_id: "u8" },
        ]),
      }],
    };
    expect(computePlanFingerprint(plan)).not.toBe(computePlanFingerprint(changedTuple));
  });

  it("dry-run and execute share the same locator object shape", async () => {
    const locator = makeRootLocator("payments", ["pay-1"]);
    const admin = {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      })),
    };
    await executePlanDeletionSlice(admin, [{ table: "payments", locator, phase: "booking_child" }]);
    expect(admin.from).toHaveBeenCalledWith("payments");
  });
});

describe("canonicalizeLocator ordering invariance", () => {
  it("sorts composite keys canonically", () => {
    const a = canonicalizeLocator(makeLocatorFromKeys("composite", ["booking_id", "user_id"], [
      { booking_id: "b2", user_id: "u2" },
      { booking_id: "b1", user_id: "u1" },
    ]));
    const b = canonicalizeLocator(makeLocatorFromKeys("composite", ["booking_id", "user_id"], [
      { booking_id: "b1", user_id: "u1" },
      { booking_id: "b2", user_id: "u2" },
    ]));
    expect(a).toEqual(b);
  });
});

describe("static contract source checks", () => {
  it("planner and operations do not use deprecated id fallback helpers", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    for (const rel of ["qa/teardown-planner.mjs", "qa/teardown-operations.mjs"]) {
      const source = fs.readFileSync(path.join(root, rel), "utf8");
      expect(source).not.toContain("getTeardownRowKeyColumn");
      expect(source).not.toContain("TEARDOWN_ROW_KEY_COLUMN");
    }
  });

  it("every contract table appears in migration key column map", () => {
    for (const table of Object.keys(TEARDOWN_TABLE_LOCATOR_CONTRACT)) {
      expect(MIGRATION_TABLE_KEY_COLUMNS[table]).toBeDefined();
    }
  });
});
