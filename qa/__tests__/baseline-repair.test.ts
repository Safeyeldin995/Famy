import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  BASELINE_REPAIR_CONFIRM_VALUE,
  parseBaselineRepairArgs,
} from "../baseline-repair-args.mjs";
import {
  BASELINE_REPAIR_PLAN_VERSION,
  INVALIDATED_BASELINE_REPAIR_FINGERPRINT_V1,
  INVALIDATED_BASELINE_REPAIR_FINGERPRINT_V2,
} from "../baseline-repair-fingerprint.mjs";
import {
  assertBaselineRepairPlanApproved,
  BASELINE_REPAIR_MAX_ZONE_MUTATIONS,
  BASELINE_REPAIR_V3_ZONES,
  buildBaselineRepairPlanFromSnapshot,
  CANONICAL_BASELINE_SETTINGS,
  createBaselineRepairManifest,
  executeBaselineRepairPlan,
  loadBaselineRepairManifest,
  planSettingBaselineAction,
  planZoneBaselineAction,
  sanitizeBaselineRepairPlanForReport,
  validateBaselineRepairManifest,
  writeBaselineRepairManifest,
} from "../baseline-repair-planner.mjs";
import { runPreflightChecks } from "../env-guard.mjs";
import { KNOWN_PRODUCTION_PROJECT_REF, KNOWN_QA_PROJECT_REF } from "../qa-identity.mjs";

const REPO_ROOT = process.cwd();
const FAKE_FINGERPRINT = "c".repeat(64);
const ZERO_CHILDREN = { zone_services: 0, zone_providers: 0, addresses: 0 };

function baselineRepairModuleUrl() {
  return pathToFileURL(path.join(REPO_ROOT, "qa/baseline-repair.mjs")).href;
}

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-08-13T11:49:05.919Z",
    ...createBaselineRepairManifest(),
    ...overrides,
  };
}

function settingsSnapshot() {
  return {
    billing: [{ key: "billing", value: CANONICAL_BASELINE_SETTINGS.billing }],
    service_areas: [{ key: "service_areas", value: CANONICAL_BASELINE_SETTINGS.service_areas }],
  };
}

function activeZoneSnapshot() {
  return Object.fromEntries(
    BASELINE_REPAIR_V3_ZONES.map((zone) => [
      zone.id,
      {
        row: { id: zone.id, name_en: zone.name, is_active: true },
        childCounts: { ...ZERO_CHILDREN },
      },
    ]),
  );
}

function validPlan() {
  const plan = buildBaselineRepairPlanFromSnapshot({
    projectRef: KNOWN_QA_PROJECT_REF,
    manifest: validManifest(),
    settingsByKey: settingsSnapshot(),
    zonesById: activeZoneSnapshot(),
  });
  if (plan.blocked || !plan.fingerprint)
    throw new Error(`invalid test plan: ${plan.blockedReason}`);
  return plan;
}

type FakeAdminOptions = {
  childOverrides?: Record<string, Partial<typeof ZERO_CHILDREN>>;
  categoryCount?: number;
  seededServiceCount?: number;
  bucketIds?: string[];
  afterUpdate?: (
    id: string,
    updateCount: number,
    childOverrides: Record<string, Partial<typeof ZERO_CHILDREN>>,
  ) => void;
};

function createFakeAdmin(options: FakeAdminOptions = {}) {
  const zones = new Map(
    BASELINE_REPAIR_V3_ZONES.map((zone) => [
      zone.id,
      {
        id: zone.id,
        name_en: zone.name,
        is_active: true,
      },
    ]),
  );
  const childOverrides = structuredClone(options.childOverrides ?? {});
  const updates: Array<{ payload: unknown; filters: Record<string, unknown> }> = [];
  const forbiddenDelete = vi.fn(() => {
    throw new Error("delete must never be called");
  });
  const forbiddenInsert = vi.fn(() => {
    throw new Error("insert must never be called");
  });

  const admin = {
    from: vi.fn((table: string) => {
      if (table === "settings") {
        return {
          insert: forbiddenInsert,
          delete: forbiddenDelete,
          select: vi.fn(() => ({
            eq: vi.fn(async (_column: string, key: string) => ({
              data: settingsSnapshot()[key as keyof ReturnType<typeof settingsSnapshot>] ?? [],
              error: null,
            })),
          })),
        };
      }
      if (["zone_services", "zone_providers"].includes(table)) {
        return {
          delete: forbiddenDelete,
          select: vi.fn(() => ({
            eq: vi.fn(async (_column: string, id: string) => ({
              count: childOverrides[id]?.[table as keyof typeof ZERO_CHILDREN] ?? 0,
              error: null,
            })),
          })),
        };
      }
      if (table === "addresses") {
        return {
          delete: forbiddenDelete,
          select: vi.fn(() => ({
            range: vi.fn(async (from: number, to: number) => ({
              data: Object.entries(childOverrides)
                .flatMap(([zoneId, counts], zoneIndex) =>
                  Array.from({ length: counts.addresses ?? 0 }, (_unused, addressIndex) => ({
                    id: `address-${zoneId}-${addressIndex}`,
                    lat: zoneIndex + 1,
                    lng: addressIndex + 1,
                    resolvedZoneId: zoneId,
                  })),
                )
                .slice(from, to + 1),
              error: null,
            })),
          })),
        };
      }
      if (table === "categories") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ count: options.categoryCount ?? 6, error: null })),
          })),
        };
      }
      if (table === "services") {
        return {
          select: vi.fn(() => ({
            not: vi.fn(() => ({
              eq: vi.fn(async () => ({ count: options.seededServiceCount ?? 18, error: null })),
            })),
          })),
        };
      }
      if (table !== "zones") throw new Error(`unexpected table ${table}`);
      return {
        delete: forbiddenDelete,
        select: vi.fn(() => {
          const filters: Record<string, unknown> = {};
          const query = {
            eq: vi.fn((column: string, value: unknown) => {
              filters[column] = value;
              return query;
            }),
            maybeSingle: vi.fn(async () => ({
              data: zones.get(String(filters.id)) ?? null,
              error: null,
            })),
          };
          return query;
        }),
        update: vi.fn((payload: { is_active?: boolean }) => {
          const filters: Record<string, unknown> = {};
          const query = {
            eq: vi.fn((column: string, value: unknown) => {
              filters[column] = value;
              return query;
            }),
            select: vi.fn(() => query),
            maybeSingle: vi.fn(async () => {
              const row = zones.get(String(filters.id));
              const matches =
                row &&
                row.name_en === filters.name_en &&
                row.is_active === filters.is_active &&
                payload.is_active === false;
              updates.push({ payload, filters: { ...filters } });
              if (!matches) return { data: null, error: null };
              row.is_active = false;
              options.afterUpdate?.(row.id, updates.length, childOverrides);
              return { data: { ...row }, error: null };
            }),
          };
          return query;
        }),
      };
    }),
    storage: {
      listBuckets: vi.fn(async () => ({
        data: (
          options.bucketIds ?? ["avatars", "provider-documents", "payment-proofs", "case-evidence"]
        ).map((id) => ({ id })),
        error: null,
      })),
    },
    rpc: vi.fn(async (_name: string, args: { p_lat: number }) => {
      const resolvedZoneId = Object.keys(childOverrides)[args.p_lat - 1];
      return { data: resolvedZoneId ? [{ zone_id: resolvedZoneId }] : [], error: null };
    }),
  };

  return { admin, updates, forbiddenDelete, forbiddenInsert, childOverrides };
}

describe("baseline repair CLI args", () => {
  it("defaults to dry-run and requires exact execute approval", () => {
    expect(parseBaselineRepairArgs([]).mode).toBe("dry-run");
    expect(parseBaselineRepairArgs(["--execute"]).mode).toBe("rejected");
    expect(
      parseBaselineRepairArgs([
        "--execute",
        `--confirm=${BASELINE_REPAIR_CONFIRM_VALUE}`,
        `--plan-fingerprint=${FAKE_FINGERPRINT}`,
      ]).mode,
    ).toBe("execute");
  });

  it("rejects dangerous, discovery, and unknown flags", () => {
    for (const flag of ["--force", "--yes", "--production", "--prod", "--no-guard", "--discover"]) {
      expect(parseBaselineRepairArgs([flag]).mode).toBe("rejected");
    }
  });
});

describe("v3 exact manifest and provenance guards", () => {
  it("binds exactly eight full ID/name/provenance tuples", () => {
    const validated = validateBaselineRepairManifest(validManifest());
    expect(validated.ok).toBe(true);
    expect(BASELINE_REPAIR_V3_ZONES).toHaveLength(8);
    expect(new Set(BASELINE_REPAIR_V3_ZONES.map((row) => row.id)).size).toBe(8);
    expect(new Set(BASELINE_REPAIR_V3_ZONES.map((row) => row.name)).size).toBe(8);
    expect(
      BASELINE_REPAIR_V3_ZONES.every(
        (row) =>
          row.name.startsWith("QA_") &&
          row.provenanceOwner.length > 0 &&
          row.provenanceClass.length > 0,
      ),
    ).toBe(true);
  });

  it("blocks Production, missing, duplicate, unexpected, renamed, and provenance-mismatched targets", () => {
    expect(
      validateBaselineRepairManifest(validManifest({ projectRef: KNOWN_PRODUCTION_PROJECT_REF }))
        .ok,
    ).toBe(false);
    expect(
      validateBaselineRepairManifest(validManifest({ zones: BASELINE_REPAIR_V3_ZONES.slice(0, 7) }))
        .ok,
    ).toBe(false);
    expect(
      validateBaselineRepairManifest(
        validManifest({
          zones: [...BASELINE_REPAIR_V3_ZONES.slice(0, 7), BASELINE_REPAIR_V3_ZONES[0]],
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateBaselineRepairManifest(
        validManifest({
          zones: BASELINE_REPAIR_V3_ZONES.map((row, index) =>
            index === 0 ? { ...row, id: "11111111-1111-4111-8111-111111111111" } : row,
          ),
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateBaselineRepairManifest(
        validManifest({
          zones: BASELINE_REPAIR_V3_ZONES.map((row, index) =>
            index === 0 ? { ...row, name: `${row.name}_renamed` } : row,
          ),
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateBaselineRepairManifest(
        validManifest({
          zones: BASELINE_REPAIR_V3_ZONES.map((row, index) =>
            index === 0 ? { ...row, provenanceClass: "unknown" } : row,
          ),
        }),
      ).ok,
    ).toBe(false);
  });
});

describe("settings and dry-run planning", () => {
  it("keeps billing and service_areas noop and blocks every setting mutation", () => {
    for (const key of ["billing", "service_areas"] as const) {
      expect(planSettingBaselineAction(key)(settingsSnapshot()[key]).actionType).toBe("noop");
      expect(planSettingBaselineAction(key)([])).toMatchObject({ blocked: true });
      expect(planSettingBaselineAction(key)([{ key, value: {} }])).toMatchObject({ blocked: true });
    }
    expect(planSettingBaselineAction("other")([])).toMatchObject({ blocked: true });
  });

  it("plans exactly eight deactivations only when all exact rows are active and child-free", () => {
    const plan = validPlan();
    expect(plan.version).toBe("6a.2-baseline-repair-v3");
    expect(plan.settings.every((row) => row.actionType === "noop")).toBe(true);
    expect(plan.zones).toHaveLength(BASELINE_REPAIR_MAX_ZONE_MUTATIONS);
    expect(
      plan.zones.every(
        (row) => row.actionType === "deactivate_zone" && row.intendedIsActive === false,
      ),
    ).toBe(true);
    expect(plan.counts.planned_mutations).toBe(8);
  });

  it("blocks missing, renamed, inactive, ID-mismatched, and nonzero-child live state", () => {
    const target = BASELINE_REPAIR_V3_ZONES[0];
    expect(planZoneBaselineAction(target, null)).toMatchObject({ blocked: true });
    expect(
      planZoneBaselineAction(target, {
        row: { id: target.id, name_en: `${target.name}_renamed`, is_active: true },
        childCounts: ZERO_CHILDREN,
      }),
    ).toMatchObject({ blocked: true });
    expect(
      planZoneBaselineAction(target, {
        row: { id: BASELINE_REPAIR_V3_ZONES[1].id, name_en: target.name, is_active: true },
        childCounts: ZERO_CHILDREN,
      }),
    ).toMatchObject({ blocked: true });
    expect(
      planZoneBaselineAction(target, {
        row: { id: target.id, name_en: target.name, is_active: false },
        childCounts: ZERO_CHILDREN,
      }),
    ).toMatchObject({ blocked: true });
    expect(
      planZoneBaselineAction(target, {
        row: { id: target.id, name_en: target.name, is_active: true },
        childCounts: { ...ZERO_CHILDREN, addresses: 1 },
      }),
    ).toMatchObject({ blocked: true });
  });

  it("blocks Production project refs and a scope that is not exactly eight", () => {
    const productionPlan = buildBaselineRepairPlanFromSnapshot({
      projectRef: KNOWN_PRODUCTION_PROJECT_REF,
      manifest: validManifest(),
      settingsByKey: settingsSnapshot(),
      zonesById: activeZoneSnapshot(),
    });
    expect(productionPlan.blockedReason).toBe("project-ref-not-qa");
    expect(productionPlan.fingerprint).toBeNull();
  });
});

describe("fingerprint and approval", () => {
  it("is stable under manifest ordering but changes with child/live state", () => {
    const base = validPlan();
    const reversed = buildBaselineRepairPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      manifest: validManifest({ zones: [...BASELINE_REPAIR_V3_ZONES].reverse() }),
      settingsByKey: settingsSnapshot(),
      zonesById: activeZoneSnapshot(),
    });
    expect(reversed.fingerprint).toBe(base.fingerprint);

    const children = activeZoneSnapshot();
    children[BASELINE_REPAIR_V3_ZONES[0].id].childCounts.addresses = 1;
    const blocked = buildBaselineRepairPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      manifest: validManifest(),
      settingsByKey: settingsSnapshot(),
      zonesById: children,
    });
    expect(blocked.fingerprint).toBeNull();
  });

  it("explicitly rejects stale v1 and v2 fingerprints", () => {
    const plan = validPlan();
    expect(() =>
      assertBaselineRepairPlanApproved(plan, INVALIDATED_BASELINE_REPAIR_FINGERPRINT_V1),
    ).toThrow(/invalidated/i);
    expect(() =>
      assertBaselineRepairPlanApproved(plan, INVALIDATED_BASELINE_REPAIR_FINGERPRINT_V2),
    ).toThrow(/invalidated/i);
    expect(() => assertBaselineRepairPlanApproved(plan, "d".repeat(64))).toThrow(/mismatch/i);
    expect(() => assertBaselineRepairPlanApproved(plan, plan.fingerprint)).not.toThrow();
    expect(BASELINE_REPAIR_PLAN_VERSION).toBe("6a.2-baseline-repair-v3");
  });
});

describe("network-free execute safety", () => {
  it("uses only eight conditional is_active=false updates and performs post-execute readback", async () => {
    const fake = createFakeAdmin();
    const execution = await executeBaselineRepairPlan(fake.admin as never, validPlan());
    expect(execution.success).toBe(true);
    expect(fake.updates).toHaveLength(8);
    expect(
      fake.updates.every(
        (row) =>
          JSON.stringify(row.payload) === JSON.stringify({ is_active: false }) &&
          typeof row.filters.id === "string" &&
          typeof row.filters.name_en === "string" &&
          row.filters.is_active === true,
      ),
    ).toBe(true);
    expect(fake.forbiddenDelete).not.toHaveBeenCalled();
    expect(fake.forbiddenInsert).not.toHaveBeenCalled();
    expect(fake.admin.from).toHaveBeenCalledWith("zone_services");
    expect(fake.admin.from).toHaveBeenCalledWith("zone_providers");
    expect(fake.admin.from).toHaveBeenCalledWith("addresses");
  });

  it("rechecks zero children immediately before mutation and starts no write on drift", async () => {
    const plan = validPlan();
    const first = plan.zones[0];
    const fake = createFakeAdmin({ childOverrides: { [first.id]: { zone_services: 1 } } });
    const execution = await executeBaselineRepairPlan(fake.admin as never, plan);
    expect(execution.success).toBe(false);
    expect(execution.mutationsStarted).toBe(false);
    expect(execution.verification?.reason).toMatch(/children-nonzero/i);
    expect(fake.updates).toHaveLength(0);
  });

  it("blocks protected catalog drift before any mutation", async () => {
    for (const options of [
      { categoryCount: 5 },
      { seededServiceCount: 17 },
      { bucketIds: ["avatars", "provider-documents", "payment-proofs"] },
    ]) {
      const fake = createFakeAdmin(options);
      await expect(executeBaselineRepairPlan(fake.admin as never, validPlan())).rejects.toThrow(
        /protected catalog drift/i,
      );
      expect(fake.updates).toHaveLength(0);
    }
  });

  it("fails post-execute readback if children appear after the final mutation", async () => {
    const fake = createFakeAdmin({
      afterUpdate: (id, count, children) => {
        if (count === 8) children[id] = { addresses: 1 };
      },
    });
    const execution = await executeBaselineRepairPlan(fake.admin as never, validPlan());
    expect(execution.success).toBe(false);
    expect(execution.verification?.reason).toMatch(/zone-readback-failed/i);
    expect(fake.updates).toHaveLength(8);
  });

  it("rejects a plan containing setting mutation or more than eight zone actions", async () => {
    const fake = createFakeAdmin();
    await expect(
      executeBaselineRepairPlan(
        fake.admin as never,
        {
          ...validPlan(),
          settings: [{ ...validPlan().settings[0], actionType: "insert_setting" }],
        } as never,
      ),
    ).rejects.toThrow(/setting mutation/i);
    await expect(
      executeBaselineRepairPlan(
        fake.admin as never,
        {
          ...validPlan(),
          zones: [...validPlan().zones, validPlan().zones[0]],
        } as never,
      ),
    ).rejects.toThrow(/exactly eight/i);
    expect(fake.updates).toHaveLength(0);
  });
});

describe("report, file, production, and import safety", () => {
  it("sanitizes full UUIDs from reports", () => {
    const report = sanitizeBaselineRepairPlanForReport(validPlan());
    const serialized = JSON.stringify(report);
    for (const zone of BASELINE_REPAIR_V3_ZONES) expect(serialized).not.toContain(zone.id);
    expect(report.zones.every((row) => !("id" in row))).toBe(true);
  });

  it("loads the compiled manifest when no report file exists and writes only validated manifests", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-baseline-v3-"));
    const manifestPath = path.join(tmpDir, "missing", "baseline-repair-targets.json");
    expect(loadBaselineRepairManifest(manifestPath).ok).toBe(true);
    writeBaselineRepairManifest(validManifest(), manifestPath);
    expect(loadBaselineRepairManifest(manifestPath).ok).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("explicitly rejects the Production project", () => {
    expect(() =>
      runPreflightChecks({
        FAMY_ENV: "qa",
        FAMY_QA_SUPABASE_PROJECT_REF: KNOWN_QA_PROJECT_REF,
        FAMY_PRODUCTION_SUPABASE_PROJECT_REF: KNOWN_PRODUCTION_PROJECT_REF,
        QA_SUPABASE_URL: `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`,
        QA_SUPABASE_PUBLISHABLE_KEY: "publishable",
        QA_SUPABASE_SECRET_KEY: "secret",
        FAMY_QA_APP_ORIGIN: "http://127.0.0.1:4173",
        FAMY_PRODUCTION_APP_ORIGIN: "https://production.example.test",
      }),
    ).toThrow(/Production/);
  });

  it("importing baseline-repair.mjs causes zero side effects", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-baseline-repair-import-"));
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      process.chdir(${JSON.stringify(tmpDir)});
      process.argv = ["node", "ignored-entry.mjs", "--execute", "--confirm=${BASELINE_REPAIR_CONFIRM_VALUE}", "--plan-fingerprint=${FAKE_FINGERPRINT}"];
      await import(${JSON.stringify(baselineRepairModuleUrl())});
      console.log("IMPORT_OK");
    `,
      ],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, FAMY_ENV: "qa" },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IMPORT_OK");
    expect(fs.readdirSync(tmpDir)).toEqual([]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
