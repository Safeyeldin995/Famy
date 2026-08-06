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
import { BASELINE_REPAIR_PLAN_VERSION, fingerprintBaselineRepairPlan } from "../baseline-repair-fingerprint.mjs";
import {
  assertBaselineRepairPlanApproved,
  buildBaselineRepairPlanFromSnapshot,
  CANONICAL_BASELINE_SETTINGS,
  discoverBaselineRepairTargets,
  executeBaselineRepairPlan,
  loadBaselineRepairManifest,
  planSettingBaselineAction,
  planZoneBaselineAction,
  PROVEN_QA_FIXTURE_ZONE_NAMES,
  sanitizeBaselineRepairPlanForReport,
  validateBaselineRepairManifest,
  writeBaselineRepairManifest,
} from "../baseline-repair-planner.mjs";
import { runPreflightChecks } from "../env-guard.mjs";
import { KNOWN_PRODUCTION_PROJECT_REF, KNOWN_QA_PROJECT_REF } from "../qa-identity.mjs";

const REPO_ROOT = process.cwd();
const FAKE_FINGERPRINT = "c".repeat(64);
const ZONE_A = "11111111-1111-4111-8111-111111111111";
const ZONE_B = "22222222-2222-4222-8222-222222222222";
const ZONE_C = "33333333-3333-4333-8333-333333333333";

function baselineRepairModuleUrl() {
  return pathToFileURL(path.join(REPO_ROOT, "qa/baseline-repair.mjs")).href;
}

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-07-20T09:00:00.000Z",
    projectRef: KNOWN_QA_PROJECT_REF,
    settingsKeys: ["billing", "service_areas"],
    zones: [
      { id: ZONE_A, name: PROVEN_QA_FIXTURE_ZONE_NAMES[0] },
      { id: ZONE_B, name: PROVEN_QA_FIXTURE_ZONE_NAMES[1] },
      { id: ZONE_C, name: PROVEN_QA_FIXTURE_ZONE_NAMES[2] },
    ],
    ...overrides,
  };
}

function activeZoneSnapshot() {
  return {
    [ZONE_A]: { id: ZONE_A, name_en: PROVEN_QA_FIXTURE_ZONE_NAMES[0], is_active: true },
    [ZONE_B]: { id: ZONE_B, name_en: PROVEN_QA_FIXTURE_ZONE_NAMES[1], is_active: true },
    [ZONE_C]: { id: ZONE_C, name_en: PROVEN_QA_FIXTURE_ZONE_NAMES[2], is_active: true },
  };
}

describe("baseline repair CLI args", () => {
  it("defaults to dry-run", () => {
    expect(parseBaselineRepairArgs([]).mode).toBe("dry-run");
  });

  it("requires exact confirmation and fingerprint for execute", () => {
    expect(parseBaselineRepairArgs(["--execute"]).mode).toBe("rejected");
    expect(parseBaselineRepairArgs([
      "--execute",
      "--confirm=WRONG",
      `--plan-fingerprint=${FAKE_FINGERPRINT}`,
    ]).mode).toBe("rejected");
    expect(parseBaselineRepairArgs([
      "--execute",
      `--confirm=${BASELINE_REPAIR_CONFIRM_VALUE}`,
    ]).mode).toBe("rejected");
    expect(parseBaselineRepairArgs([
      "--execute",
      `--confirm=${BASELINE_REPAIR_CONFIRM_VALUE}`,
      `--plan-fingerprint=${FAKE_FINGERPRINT}`,
    ]).mode).toBe("execute");
  });

  it("rejects dangerous and unknown flags", () => {
    for (const flag of ["--force", "--yes", "--production", "--prod", "--no-guard"]) {
      expect(parseBaselineRepairArgs([flag]).mode).toBe("rejected");
    }
    expect(parseBaselineRepairArgs(["--discover"]).mode).toBe("rejected");
  });
});

describe("baseline repair manifest validation", () => {
  it("rejects production ref and invalid manifests", () => {
    expect(validateBaselineRepairManifest(validManifest({ projectRef: KNOWN_PRODUCTION_PROJECT_REF })).ok).toBe(false);
    expect(loadBaselineRepairManifest(path.join(REPO_ROOT, "qa/__tests__/missing-manifest.json")).ok).toBe(false);
    expect(validateBaselineRepairManifest(null).ok).toBe(false);
  });

  it("requires exactly three unique QA zones with proven names", () => {
    expect(validateBaselineRepairManifest(validManifest({ zones: [] })).ok).toBe(false);
    expect(validateBaselineRepairManifest(validManifest({
      zones: [
        { id: ZONE_A, name: PROVEN_QA_FIXTURE_ZONE_NAMES[0] },
        { id: ZONE_B, name: PROVEN_QA_FIXTURE_ZONE_NAMES[1] },
      ],
    })).ok).toBe(false);
    expect(validateBaselineRepairManifest(validManifest({
      zones: [
        { id: ZONE_A, name: PROVEN_QA_FIXTURE_ZONE_NAMES[0] },
        { id: ZONE_A, name: PROVEN_QA_FIXTURE_ZONE_NAMES[1] },
        { id: ZONE_C, name: PROVEN_QA_FIXTURE_ZONE_NAMES[2] },
      ],
    })).ok).toBe(false);
    expect(validateBaselineRepairManifest(validManifest({
      zones: [
        { id: ZONE_A, name: "Not_QA_zone" },
        { id: ZONE_B, name: PROVEN_QA_FIXTURE_ZONE_NAMES[1] },
        { id: ZONE_C, name: PROVEN_QA_FIXTURE_ZONE_NAMES[2] },
      ],
    })).ok).toBe(false);
    expect(validateBaselineRepairManifest(validManifest()).ok).toBe(true);
  });
});

describe("baseline repair setting planning", () => {
  it("plans insert when absent", () => {
    const planBilling = planSettingBaselineAction("billing")([]);
    expect(planBilling.actionType).toBe("insert_setting");
    expect(planBilling.beforeState).toBe("absent");
  });

  it("plans noop when exact match exists", () => {
    const planBilling = planSettingBaselineAction("billing")([{
      key: "billing",
      value: CANONICAL_BASELINE_SETTINGS.billing,
    }]);
    expect(planBilling.actionType).toBe("noop");
  });

  it("blocks conflicting existing setting", () => {
    const planBilling = planSettingBaselineAction("billing")([{
      key: "billing",
      value: { vat_percent: 99, platform_fee: 1 },
    }]);
    expect("blocked" in planBilling && planBilling.blocked).toBe(true);
  });
});

describe("baseline repair zone planning", () => {
  it("plans deactivate for active exact zone", () => {
    const result = planZoneBaselineAction(
      { id: ZONE_A, name: PROVEN_QA_FIXTURE_ZONE_NAMES[0] },
      { id: ZONE_A, name_en: PROVEN_QA_FIXTURE_ZONE_NAMES[0], is_active: true },
    );
    expect(result.actionType).toBe("deactivate_zone");
  });

  it("plans noop for inactive exact zone", () => {
    const result = planZoneBaselineAction(
      { id: ZONE_A, name: PROVEN_QA_FIXTURE_ZONE_NAMES[0] },
      { id: ZONE_A, name_en: PROVEN_QA_FIXTURE_ZONE_NAMES[0], is_active: false },
    );
    expect(result.actionType).toBe("noop");
  });

  it("blocks missing or mismatched zones", () => {
    expect("blocked" in planZoneBaselineAction(
      { id: ZONE_A, name: PROVEN_QA_FIXTURE_ZONE_NAMES[0] },
      null,
    )).toBe(true);
    expect("blocked" in planZoneBaselineAction(
      { id: ZONE_A, name: PROVEN_QA_FIXTURE_ZONE_NAMES[0] },
      { id: ZONE_A, name_en: "QA_renamed_zone", is_active: true },
    )).toBe(true);
  });
});

describe("baseline repair fingerprint", () => {
  it("is stable under ordering changes", () => {
    const manifest = validManifest();
    const base = buildBaselineRepairPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      manifest: validateBaselineRepairManifest(manifest).ok
        ? validateBaselineRepairManifest(manifest).manifest
        : manifest,
      settingsByKey: { billing: [], service_areas: [] },
      zonesById: activeZoneSnapshot(),
    });
    const reversed = buildBaselineRepairPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      manifest: {
        settingsKeys: ["billing", "service_areas"],
        zones: [...manifest.zones].reverse(),
      },
      settingsByKey: { billing: [], service_areas: [] },
      zonesById: activeZoneSnapshot(),
    });
    expect(base.fingerprint).toBe(reversed.fingerprint);
  });

  it("changes when value, id, or state changes", () => {
    const manifest = validManifest();
    const validated = validateBaselineRepairManifest(manifest);
    if (!validated.ok) throw new Error("invalid manifest fixture");
    const base = buildBaselineRepairPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      manifest: validated.manifest,
      settingsByKey: { billing: [], service_areas: [] },
      zonesById: activeZoneSnapshot(),
    });
    const changedValue = buildBaselineRepairPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      manifest: validated.manifest,
      settingsByKey: {
        billing: [{ key: "billing", value: CANONICAL_BASELINE_SETTINGS.billing }],
        service_areas: [],
      },
      zonesById: activeZoneSnapshot(),
    });
    const inactiveZones = buildBaselineRepairPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      manifest: validated.manifest,
      settingsByKey: { billing: [], service_areas: [] },
      zonesById: {
        [ZONE_A]: { id: ZONE_A, name_en: PROVEN_QA_FIXTURE_ZONE_NAMES[0], is_active: false },
        [ZONE_B]: { id: ZONE_B, name_en: PROVEN_QA_FIXTURE_ZONE_NAMES[1], is_active: false },
        [ZONE_C]: { id: ZONE_C, name_en: PROVEN_QA_FIXTURE_ZONE_NAMES[2], is_active: false },
      },
    });
    expect(changedValue.fingerprint).not.toBe(base.fingerprint);
    expect(inactiveZones.fingerprint).not.toBe(base.fingerprint);
  });
});

describe("baseline repair execute safety", () => {
  it("rebuild catches drift before writes", () => {
    const approved = {
      blocked: false,
      version: BASELINE_REPAIR_PLAN_VERSION,
      fingerprint: FAKE_FINGERPRINT,
    };
    expect(() => assertBaselineRepairPlanApproved(approved as never, "d".repeat(64)))
      .toThrow(/fingerprint mismatch/i);
    expect(() => assertBaselineRepairPlanApproved({ ...approved, blocked: true, blockedReason: "x" } as never, FAKE_FINGERPRINT))
      .toThrow(/blocked/i);
  });

  it("returns failure on partial write/readback failure", async () => {
    const manifest = validateBaselineRepairManifest(validManifest());
    if (!manifest.ok) throw new Error("invalid manifest fixture");
    const plan = buildBaselineRepairPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      manifest: manifest.manifest,
      settingsByKey: { billing: [], service_areas: [] },
      zonesById: activeZoneSnapshot(),
    });

    const admin = {
      from: vi.fn((table) => ({
        insert: vi.fn(async () => ({ error: table === "settings" ? { message: "insert failed" } : null })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      })),
      storage: { listBuckets: vi.fn(async () => ({ data: [], error: null })) },
    };

    const failedInsert = await executeBaselineRepairPlan(admin as never, plan);
    expect(failedInsert.success).toBe(false);

    const adminReadbackFail = {
      from: vi.fn((table) => ({
        insert: vi.fn(async () => ({ error: null })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        select: vi.fn(() => ({
          eq: vi.fn((_column, value) => ({
            maybeSingle: vi.fn(async () => ({
              data: table === "settings" && value === "billing"
                ? { value: { vat_percent: 0, platform_fee: 0 } }
                : table === "zones"
                  ? { is_active: true }
                  : { value: CANONICAL_BASELINE_SETTINGS.service_areas },
              error: null,
            })),
          })),
        })),
      })),
      storage: {
        listBuckets: vi.fn(async () => ({
          data: [
            { id: "avatars" },
            { id: "provider-documents" },
            { id: "payment-proofs" },
            { id: "case-evidence" },
          ],
          error: null,
        })),
      },
    };

    const failedReadback = await executeBaselineRepairPlan(adminReadbackFail as never, plan);
    expect(failedReadback.success).toBe(false);
  });

  it("mutates only two settings and three zones", () => {
    const manifest = validateBaselineRepairManifest(validManifest());
    if (!manifest.ok) throw new Error("invalid manifest fixture");
    const plan = buildBaselineRepairPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      manifest: manifest.manifest,
      settingsByKey: { billing: [], service_areas: [] },
      zonesById: activeZoneSnapshot(),
    });
    expect(plan.settings).toHaveLength(2);
    expect(plan.zones).toHaveLength(3);
    expect(plan.settings.every((row) => row.actionType === "insert_setting")).toBe(true);
    expect(plan.zones.every((row) => row.actionType === "deactivate_zone")).toBe(true);
    expect(plan.counts.planned_mutations).toBe(5);
  });
});

describe("baseline repair output hygiene", () => {
  it("sanitized report contains no full UUID", () => {
    const manifest = validateBaselineRepairManifest(validManifest());
    if (!manifest.ok) throw new Error("invalid manifest fixture");
    const plan = buildBaselineRepairPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      manifest: manifest.manifest,
      settingsByKey: { billing: [], service_areas: [] },
      zonesById: activeZoneSnapshot(),
    });
    const report = sanitizeBaselineRepairPlanForReport(plan);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/11111111-1111-4111-8111-111111111111/);
    expect(report.zones.every((row) => "id" in row === false)).toBe(true);
  });
});

describe("production guard", () => {
  it("rejects production ref", () => {
    expect(() => runPreflightChecks({
      FAMY_ENV: "qa",
      FAMY_QA_SUPABASE_PROJECT_REF: KNOWN_QA_PROJECT_REF,
      FAMY_PRODUCTION_SUPABASE_PROJECT_REF: KNOWN_PRODUCTION_PROJECT_REF,
      QA_SUPABASE_URL: `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`,
      QA_SUPABASE_SECRET_KEY: "test-secret-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-secret-key",
      QA_E2E_APP_ORIGIN: "http://127.0.0.1:4173",
    })).toThrow(/Production/);
  });
});

describe("native import safety", () => {
  it("importing baseline-repair.mjs causes zero side effects", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-baseline-repair-import-"));
    const script = `
      process.chdir(${JSON.stringify(tmpDir)});
      process.argv = [
        "node",
        "ignored-entry.mjs",
        "--execute",
        "--confirm=${BASELINE_REPAIR_CONFIRM_VALUE}",
        "--plan-fingerprint=${FAKE_FINGERPRINT}",
      ];
      await import(${JSON.stringify(baselineRepairModuleUrl())});
      console.log("IMPORT_OK");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: REPO_ROOT,
      env: { ...process.env, FAMY_ENV: "qa" },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IMPORT_OK");
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });
});

describe("baseline repair discovery", () => {
  it("requires exactly three proven QA zones", async () => {
    const admin = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(async () => ({
            data: [
              { id: ZONE_A, name_en: PROVEN_QA_FIXTURE_ZONE_NAMES[0], is_active: true },
              { id: ZONE_B, name_en: PROVEN_QA_FIXTURE_ZONE_NAMES[1], is_active: true },
            ],
            error: null,
          })),
        })),
      })),
    };
    await expect(discoverBaselineRepairTargets(admin as never)).rejects.toThrow(/missing approved QA zone/i);
  });
});

describe("baseline repair manifest write", () => {
  it("writes validated manifest to report path", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-baseline-manifest-"));
    const manifestPath = path.join(tmpDir, "baseline-repair-targets.json");
    writeBaselineRepairManifest(validManifest(), manifestPath);
    const loaded = loadBaselineRepairManifest(manifestPath);
    expect(loaded.ok).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("baseline repair fingerprint helper", () => {
  it("matches planner fingerprint payload", () => {
    const digest = fingerprintBaselineRepairPlan({
      projectRef: KNOWN_QA_PROJECT_REF,
      blocked: false,
      blockedReason: null,
      manifestHash: "abc",
      settings: [{
        key: "billing",
        beforeState: "absent",
        beforeValue: null,
        intendedValue: CANONICAL_BASELINE_SETTINGS.billing,
        actionType: "insert_setting",
      }],
      zones: [{
        id: ZONE_A,
        name: PROVEN_QA_FIXTURE_ZONE_NAMES[0],
        beforeIsActive: true,
        intendedIsActive: false,
        actionType: "deactivate_zone",
      }],
    });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
