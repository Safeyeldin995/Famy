import fs from "node:fs";
import path from "node:path";
import { maskUserId } from "./qa-classification.mjs";
import { KNOWN_QA_PROJECT_REF } from "./qa-identity.mjs";
import {
  EXPECTED_ACTIVE_CATEGORY_COUNT,
  EXPECTED_SEEDED_NON_QA_SERVICE_COUNT,
  EXPECTED_STORAGE_BUCKET_COUNT,
  REQUIRED_SETTINGS_KEYS,
} from "./e2e-baseline.mjs";
import {
  BASELINE_REPAIR_PLAN_VERSION,
  fingerprintBaselineRepairPlan,
  hashBaselineRepairManifestIdentity,
  INVALIDATED_BASELINE_REPAIR_FINGERPRINT_V1,
  INVALIDATED_BASELINE_REPAIR_FINGERPRINT_V2,
} from "./baseline-repair-fingerprint.mjs";

export const BASELINE_REPAIR_MANIFEST_FILENAME = "baseline-repair-targets.json";
export const BASELINE_REPAIR_MAX_ZONE_MUTATIONS = 8;

/**
 * Exact v3 targets proven by qa/report/zone-ownership-inventory.json and its
 * full-ID residue inventory. This is intentionally compiled into the planner:
 * discovery may verify these tuples, but it may never broaden them.
 */
export const BASELINE_REPAIR_V3_ZONES = Object.freeze([
  {
    id: "16079e5f-b915-4afa-aa64-2b5a40bd6597",
    name: "QA_booking_lifecycle_zone_v1",
    provenanceOwner: "booking-lifecycle-fixtures.mjs",
    provenanceClass: "proven_fixture_v1",
  },
  {
    id: "5e8fdf99-4d6d-47a2-a686-38d4ce9cbf66",
    name: "QA_Patch2_BookingZone_1786618187940",
    provenanceOwner: "marketplace-fixtures.mjs",
    provenanceClass: "marketplace_e2e_leak",
  },
  {
    id: "325e3a13-1355-4cde-84ff-9a396f305691",
    name: "QA_status_selector_zone_1786617970885",
    provenanceOwner: "admin-audit-fixes.spec.ts",
    provenanceClass: "admin_audit_leak",
  },
  {
    id: "2cab8a7a-9a62-4448-af89-1337c56197a3",
    name: "QA_Patch2_BookingZone_1786618162276",
    provenanceOwner: "marketplace-fixtures.mjs",
    provenanceClass: "marketplace_e2e_leak",
  },
  {
    id: "fa07c30c-5fdb-4b91-8810-042392e89155",
    name: "QA_Patch2_BookingZone_1786618227906",
    provenanceOwner: "marketplace-fixtures.mjs",
    provenanceClass: "marketplace_e2e_leak",
  },
  {
    id: "a832d8d6-b8bf-4ec5-ad70-901e9f592dbd",
    name: "QA_Patch2_BookingZone_1786618325877",
    provenanceOwner: "marketplace-fixtures.mjs",
    provenanceClass: "marketplace_e2e_leak",
  },
  {
    id: "5d194025-a4b3-4a50-9923-cc75357fb4ce",
    name: "QA_Patch2_BookingZone_1786618438975",
    provenanceOwner: "marketplace-fixtures.mjs",
    provenanceClass: "marketplace_e2e_leak",
  },
  {
    id: "59eb5b1a-79f0-4c98-8a82-4a528a5bf1f6",
    name: "QA_Patch2_Zone_1786618351949",
    provenanceOwner: "provider-eligibility.spec.ts",
    provenanceClass: "provider_eligibility_leak",
  },
]);

/** @type {Record<string, unknown>} */
export const CANONICAL_BASELINE_SETTINGS = {
  billing: { vat_percent: 14, platform_fee: 25 },
  service_areas: {
    areas: [
      { name: "Sheikh Zayed", enabled: true },
      { name: "6th of October", enabled: true },
    ],
  },
};

const REQUIRED_STORAGE_BUCKETS = [
  "avatars",
  "provider-documents",
  "payment-proofs",
  "case-evidence",
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHILD_TABLES = Object.freeze([
  { table: "zone_services", column: "zone_id" },
  { table: "zone_providers", column: "zone_id" },
  { table: "addresses", column: "zone_id" },
]);

export function baselineRepairManifestPath(cwd = process.cwd()) {
  return path.resolve(cwd, "qa/report", BASELINE_REPAIR_MANIFEST_FILENAME);
}

export function maskProjectRef(projectRef) {
  if (!projectRef || projectRef.length < 12) return "****";
  return `${projectRef.slice(0, 4)}…${projectRef.slice(-4)}`;
}

export function valuesDeepEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = /** @type {Record<string, unknown>} */ (value);
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function createBaselineRepairManifest() {
  return {
    projectRef: KNOWN_QA_PROJECT_REF,
    settingsKeys: [...REQUIRED_SETTINGS_KEYS],
    zones: BASELINE_REPAIR_V3_ZONES.map((zone) => ({ ...zone })),
  };
}

/** @param {unknown} manifest */
export function validateBaselineRepairManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, reason: "manifest-missing-or-invalid" };
  }
  const row = /** @type {Record<string, unknown>} */ (manifest);
  if (row.projectRef !== KNOWN_QA_PROJECT_REF) {
    return { ok: false, reason: "manifest-project-ref-mismatch" };
  }

  const settingsKeys = Array.isArray(row.settingsKeys) ? row.settingsKeys.map(String) : [];
  const expectedSettings = [...REQUIRED_SETTINGS_KEYS].sort();
  if (
    settingsKeys.length !== expectedSettings.length ||
    ![...settingsKeys].sort().every((key, index) => key === expectedSettings[index])
  ) {
    return { ok: false, reason: "manifest-settings-keys-invalid" };
  }

  const zonesRaw = Array.isArray(row.zones) ? row.zones : [];
  if (zonesRaw.length !== BASELINE_REPAIR_MAX_ZONE_MUTATIONS) {
    return { ok: false, reason: "manifest-zone-count-invalid" };
  }
  const expectedById = new Map(BASELINE_REPAIR_V3_ZONES.map((zone) => [zone.id, zone]));
  const seenIds = new Set();
  const seenNames = new Set();
  const zones = [];

  for (const entry of zonesRaw) {
    if (!entry || typeof entry !== "object") return { ok: false, reason: "manifest-zone-invalid" };
    const zone = /** @type {Record<string, unknown>} */ (entry);
    const id = typeof zone.id === "string" ? zone.id : "";
    const name = typeof zone.name === "string" ? zone.name : "";
    const provenanceOwner = typeof zone.provenanceOwner === "string" ? zone.provenanceOwner : "";
    const provenanceClass = typeof zone.provenanceClass === "string" ? zone.provenanceClass : "";
    if (!UUID_RE.test(id)) return { ok: false, reason: "manifest-zone-id-invalid" };
    if (!name.startsWith("QA_")) return { ok: false, reason: "manifest-zone-non-qa" };
    if (seenIds.has(id) || seenNames.has(name))
      return { ok: false, reason: "manifest-zone-duplicate" };
    const expected = expectedById.get(id);
    if (
      !expected ||
      expected.name !== name ||
      expected.provenanceOwner !== provenanceOwner ||
      expected.provenanceClass !== provenanceClass
    ) {
      return { ok: false, reason: "manifest-zone-tuple-mismatch" };
    }
    seenIds.add(id);
    seenNames.add(name);
    zones.push({ id, name, provenanceOwner, provenanceClass });
  }
  if (seenIds.size !== expectedById.size) return { ok: false, reason: "manifest-zone-missing" };

  return {
    ok: true,
    manifest: {
      generatedAt: typeof row.generatedAt === "string" ? row.generatedAt : undefined,
      projectRef: KNOWN_QA_PROJECT_REF,
      settingsKeys: [...REQUIRED_SETTINGS_KEYS],
      zones: zones.sort((a, b) => a.id.localeCompare(b.id)),
    },
  };
}

export function loadBaselineRepairManifest(manifestPath = baselineRepairManifestPath()) {
  if (!fs.existsSync(manifestPath)) {
    return validateBaselineRepairManifest(createBaselineRepairManifest());
  }
  try {
    return validateBaselineRepairManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  } catch {
    return { ok: false, reason: "manifest-parse-error" };
  }
}

export function writeBaselineRepairManifest(manifest, manifestPath = baselineRepairManifestPath()) {
  const validated = validateBaselineRepairManifest(manifest);
  if (!validated.ok)
    throw new Error(`[qa-baseline-repair] refused to write invalid manifest: ${validated.reason}`);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        generatedAt:
          typeof manifest.generatedAt === "string"
            ? manifest.generatedAt
            : new Date().toISOString(),
        ...validated.manifest,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return manifestPath;
}

export function planSettingBaselineAction(key) {
  return (rows) => {
    if (!REQUIRED_SETTINGS_KEYS.includes(key))
      return { blocked: true, reason: "unexpected-settings-target" };
    if (rows.length > 1) return { blocked: true, reason: `duplicate-settings-${key}` };
    if (rows.length === 0) return { blocked: true, reason: `missing-settings-${key}` };
    const existing = rows[0]?.value;
    if (!valuesDeepEqual(existing, CANONICAL_BASELINE_SETTINGS[key])) {
      return { blocked: true, reason: `conflicting-settings-${key}` };
    }
    return {
      actionType: "noop",
      key,
      beforeState: "present",
      beforeValue: existing,
      intendedValue: CANONICAL_BASELINE_SETTINGS[key],
    };
  };
}

function childrenAreZero(childCounts) {
  return CHILD_TABLES.every(({ table }) => Number(childCounts?.[table]) === 0);
}

export function planZoneBaselineAction(manifestZone, liveSnapshot) {
  if (!manifestZone.name.startsWith("QA_")) return { blocked: true, reason: "non-qa-zone-name" };
  const expected = BASELINE_REPAIR_V3_ZONES.find((zone) => zone.id === manifestZone.id);
  if (
    !expected ||
    expected.name !== manifestZone.name ||
    expected.provenanceOwner !== manifestZone.provenanceOwner ||
    expected.provenanceClass !== manifestZone.provenanceClass
  ) {
    return { blocked: true, reason: `unproven-zone-${manifestZone.name}` };
  }
  if (!liveSnapshot?.row) return { blocked: true, reason: `missing-zone-${manifestZone.name}` };
  const liveRow = liveSnapshot.row;
  if (liveRow.id !== manifestZone.id)
    return { blocked: true, reason: `zone-id-mismatch-${manifestZone.name}` };
  if (liveRow.name_en !== manifestZone.name)
    return { blocked: true, reason: `zone-name-mismatch-${manifestZone.name}` };
  if (!liveRow.name_en.startsWith("QA_")) return { blocked: true, reason: "non-qa-zone-live" };
  if (!childrenAreZero(liveSnapshot.childCounts))
    return { blocked: true, reason: `zone-children-nonzero-${manifestZone.name}` };
  if (liveRow.is_active !== true)
    return { blocked: true, reason: `zone-not-active-${manifestZone.name}` };
  return {
    actionType: "deactivate_zone",
    id: manifestZone.id,
    name: manifestZone.name,
    provenanceOwner: manifestZone.provenanceOwner,
    provenanceClass: manifestZone.provenanceClass,
    childCounts: { ...liveSnapshot.childCounts },
    beforeIsActive: true,
    intendedIsActive: false,
  };
}

export function buildBaselineRepairPlanFromSnapshot(input) {
  const validated = validateBaselineRepairManifest(input.manifest);
  if (!validated.ok) {
    return finalizeBaselineRepairPlan({
      projectRef: input.projectRef,
      manifest: createBaselineRepairManifest(),
      blockedReason: validated.reason,
      settingActions: [],
      zoneActions: [],
    });
  }
  const manifest = validated.manifest;
  let blockedReason = input.projectRef === KNOWN_QA_PROJECT_REF ? null : "project-ref-not-qa";
  const settingActions = [];
  const zoneActions = [];

  if (!blockedReason) {
    for (const key of [...REQUIRED_SETTINGS_KEYS].sort()) {
      const result = planSettingBaselineAction(key)(input.settingsByKey[key] ?? []);
      if (result.blocked) {
        blockedReason = result.reason;
        break;
      }
      settingActions.push(result);
    }
  }
  if (!blockedReason) {
    for (const manifestZone of manifest.zones) {
      const result = planZoneBaselineAction(manifestZone, input.zonesById[manifestZone.id] ?? null);
      if (result.blocked) {
        blockedReason = result.reason;
        break;
      }
      zoneActions.push({ ...result, maskedId: maskUserId(result.id) });
    }
  }

  if (!blockedReason && settingActions.some((row) => row.actionType !== "noop")) {
    blockedReason = "setting-mutation-forbidden";
  }
  if (
    !blockedReason &&
    (zoneActions.length !== BASELINE_REPAIR_MAX_ZONE_MUTATIONS ||
      zoneActions.some((row) => row.actionType !== "deactivate_zone"))
  ) {
    blockedReason = "scope-does-not-match-eight-targets";
  }
  if (
    !blockedReason &&
    zoneActions.filter((row) => row.actionType === "deactivate_zone").length >
      BASELINE_REPAIR_MAX_ZONE_MUTATIONS
  ) {
    blockedReason = "scope-exceeds-authorized-targets";
  }

  return finalizeBaselineRepairPlan({
    projectRef: input.projectRef,
    manifest,
    blockedReason,
    settingActions,
    zoneActions,
  });
}

export function finalizeBaselineRepairPlan(input) {
  const blocked = Boolean(input.blockedReason);
  const manifestHash = hashBaselineRepairManifestIdentity(input.manifest);
  const fingerprintPayload = {
    projectRef: input.projectRef,
    blocked,
    blockedReason: input.blockedReason,
    manifestHash,
    settings: input.settingActions,
    zones: input.zoneActions,
  };
  return {
    version: BASELINE_REPAIR_PLAN_VERSION,
    projectRef: input.projectRef,
    maskedProjectRef: maskProjectRef(input.projectRef),
    manifestHash,
    blocked,
    blockedReason: input.blockedReason,
    fingerprint: blocked ? null : fingerprintBaselineRepairPlan(fingerprintPayload),
    settings: input.settingActions,
    zones: input.zoneActions,
    counts: {
      setting_targets: input.settingActions.length,
      zone_targets: input.zoneActions.length,
      planned_mutations:
        input.settingActions.filter((row) => row.actionType !== "noop").length +
        input.zoneActions.filter((row) => row.actionType !== "noop").length,
    },
  };
}

export async function readSettingsRowsForBaseline(admin) {
  const settingsByKey = {};
  for (const key of REQUIRED_SETTINGS_KEYS) {
    const { data, error } = await admin.from("settings").select("key,value").eq("key", key);
    if (error)
      throw new Error(`[qa-baseline-repair] failed to read settings key ${key}: ${error.message}`);
    settingsByKey[key] = data ?? [];
  }
  return settingsByKey;
}

export async function readZoneChildCounts(admin, zoneId) {
  const counts = {};
  for (const { table, column } of CHILD_TABLES) {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(column, zoneId);
    if (error)
      throw new Error(
        `[qa-baseline-repair] failed to count ${table} for zone ${maskUserId(zoneId)}: ${error.message}`,
      );
    counts[table] = count ?? 0;
  }
  return counts;
}

export async function readZoneSafetyState(admin, manifestZone) {
  const { data, error } = await admin
    .from("zones")
    .select("id,name_en,is_active")
    .eq("id", manifestZone.id)
    .maybeSingle();
  if (error)
    throw new Error(
      `[qa-baseline-repair] failed to read zone ${manifestZone.name}: ${error.message}`,
    );
  return {
    row: data ? { id: data.id, name_en: data.name_en, is_active: Boolean(data.is_active) } : null,
    childCounts: await readZoneChildCounts(admin, manifestZone.id),
  };
}

export async function readManifestZonesForBaseline(admin, manifestZones) {
  const zonesById = {};
  for (const zone of manifestZones) zonesById[zone.id] = await readZoneSafetyState(admin, zone);
  return zonesById;
}

export async function buildBaselineRepairPlanFromAdmin(admin, projectRef, manifest) {
  return buildBaselineRepairPlanFromSnapshot({
    projectRef,
    manifest,
    settingsByKey: await readSettingsRowsForBaseline(admin),
    zonesById: await readManifestZonesForBaseline(admin, manifest.zones),
  });
}

export async function discoverBaselineRepairTargets(admin) {
  const manifest = createBaselineRepairManifest();
  const zonesById = await readManifestZonesForBaseline(admin, manifest.zones);
  for (const zone of manifest.zones) {
    const planned = planZoneBaselineAction(zone, zonesById[zone.id]);
    if (planned.blocked) throw new Error(`[qa-baseline-repair] ${planned.reason}`);
  }
  return { generatedAt: new Date().toISOString(), ...manifest };
}

export function sanitizeBaselineRepairPlanForReport(plan) {
  return {
    version: plan.version,
    maskedProjectRef: plan.maskedProjectRef,
    manifestHash: plan.manifestHash,
    blocked: plan.blocked,
    blockedReason: plan.blockedReason ?? null,
    fingerprint: plan.fingerprint,
    counts: plan.counts,
    settings: plan.settings.map((row) => ({
      key: row.key,
      beforeState: row.beforeState,
      actionType: row.actionType,
      intendedValue: row.intendedValue,
    })),
    zones: plan.zones.map((row) => ({
      maskedId: row.maskedId,
      name: row.name,
      provenanceOwner: row.provenanceOwner,
      provenanceClass: row.provenanceClass,
      childCounts: row.childCounts,
      beforeIsActive: row.beforeIsActive,
      intendedIsActive: row.intendedIsActive,
      actionType: row.actionType,
    })),
    protectedCatalog: plan.protectedCatalog ?? null,
  };
}

export function assertBaselineRepairPlanApproved(freshPlan, expectedFingerprint) {
  if (freshPlan.blocked)
    throw new Error(`[qa-baseline-repair] plan blocked: ${freshPlan.blockedReason ?? "unknown"}`);
  if (freshPlan.version !== BASELINE_REPAIR_PLAN_VERSION)
    throw new Error("[qa-baseline-repair] plan version mismatch — rebuild dry-run and re-approve");
  if (!expectedFingerprint)
    throw new Error("[qa-baseline-repair] execute requires --plan-fingerprint from dry-run");
  if (
    [
      INVALIDATED_BASELINE_REPAIR_FINGERPRINT_V1,
      INVALIDATED_BASELINE_REPAIR_FINGERPRINT_V2,
    ].includes(expectedFingerprint)
  ) {
    throw new Error(
      "[qa-baseline-repair] plan fingerprint invalidated — rebuild dry-run and re-approve",
    );
  }
  if (freshPlan.fingerprint !== expectedFingerprint)
    throw new Error(
      "[qa-baseline-repair] plan fingerprint mismatch — rebuild dry-run and re-approve",
    );
}

export async function verifyProtectedCatalogCounts(admin) {
  const { count: categoryCount, error: categoryError } = await admin
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  if (categoryError)
    throw new Error(`[qa-baseline-repair] failed to count categories: ${categoryError.message}`);
  const { count: seededServiceCount, error: serviceError } = await admin
    .from("services")
    .select("id", { count: "exact", head: true })
    .not("name_en", "ilike", "QA_%")
    .eq("is_active", true);
  if (serviceError)
    throw new Error(
      `[qa-baseline-repair] failed to count seeded services: ${serviceError.message}`,
    );
  const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
  if (bucketError)
    throw new Error(`[qa-baseline-repair] failed to list storage buckets: ${bucketError.message}`);
  const bucketIds = new Set((buckets ?? []).map((row) => row.id));
  return {
    ok:
      categoryCount === EXPECTED_ACTIVE_CATEGORY_COUNT &&
      seededServiceCount === EXPECTED_SEEDED_NON_QA_SERVICE_COUNT &&
      bucketIds.size === EXPECTED_STORAGE_BUCKET_COUNT &&
      REQUIRED_STORAGE_BUCKETS.every((id) => bucketIds.has(id)),
    categoryCount,
    seededServiceCount,
    storageBucketCount: bucketIds.size,
  };
}

async function assertSettingsStillNoop(admin, plan) {
  const rows = await readSettingsRowsForBaseline(admin);
  for (const action of plan.settings) {
    const current = planSettingBaselineAction(action.key)(rows[action.key] ?? []);
    if (
      current.blocked ||
      current.actionType !== "noop" ||
      !valuesDeepEqual(current.beforeValue, action.beforeValue)
    ) {
      throw new Error(`[qa-baseline-repair] setting live state changed: ${action.key}`);
    }
  }
}

function assertCatalogSafe(catalog) {
  if (!catalog.ok) throw new Error("[qa-baseline-repair] protected catalog drift detected");
}

export async function executeBaselineRepairPlan(admin, plan) {
  if (plan.blocked)
    throw new Error(`[qa-baseline-repair] plan blocked: ${plan.blockedReason ?? "unknown"}`);
  if (plan.settings.some((row) => row.actionType !== "noop"))
    throw new Error("[qa-baseline-repair] setting mutation forbidden");
  const actions = plan.zones.filter((row) => row.actionType !== "noop");
  if (
    actions.length !== BASELINE_REPAIR_MAX_ZONE_MUTATIONS ||
    actions.some((row) => row.actionType !== "deactivate_zone")
  ) {
    throw new Error("[qa-baseline-repair] execute scope must be exactly eight zone deactivations");
  }

  await assertSettingsStillNoop(admin, plan);
  assertCatalogSafe(await verifyProtectedCatalogCounts(admin));
  const results = [];
  let mutationsStarted = false;

  for (const action of actions) {
    const immediate = planZoneBaselineAction(action, await readZoneSafetyState(admin, action));
    if (immediate.blocked) {
      return {
        success: false,
        mutationsStarted,
        results,
        verification: { reason: `pre-mutation-${immediate.reason}` },
      };
    }
    assertCatalogSafe(await verifyProtectedCatalogCounts(admin));
    mutationsStarted = true;
    const { data, error } = await admin
      .from("zones")
      .update({ is_active: false })
      .eq("id", action.id)
      .eq("name_en", action.name)
      .eq("is_active", true)
      .select("id,name_en,is_active")
      .maybeSingle();
    const ok =
      !error &&
      data?.id === action.id &&
      data?.name_en === action.name &&
      data?.is_active === false;
    results.push({
      entityType: "zone",
      maskedId: action.maskedId,
      actionType: action.actionType,
      ok,
      reason: error?.message ?? (ok ? undefined : "conditional-deactivate-readback-mismatch"),
    });
    if (!ok) return { success: false, mutationsStarted, results, verification: null };
  }

  for (const action of actions) {
    const readback = await readZoneSafetyState(admin, action);
    if (
      !readback.row ||
      readback.row.id !== action.id ||
      readback.row.name_en !== action.name ||
      readback.row.is_active !== false ||
      !childrenAreZero(readback.childCounts)
    ) {
      return {
        success: false,
        mutationsStarted,
        results,
        verification: { reason: `zone-readback-failed-${action.name}` },
      };
    }
  }
  await assertSettingsStillNoop(admin, plan);
  const protectedCatalog = await verifyProtectedCatalogCounts(admin);
  return {
    success:
      results.length === BASELINE_REPAIR_MAX_ZONE_MUTATIONS &&
      results.every((row) => row.ok) &&
      protectedCatalog.ok,
    mutationsStarted,
    results,
    verification: { protectedCatalog },
  };
}
