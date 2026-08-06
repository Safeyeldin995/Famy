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
} from "./baseline-repair-fingerprint.mjs";

export const BASELINE_REPAIR_MANIFEST_FILENAME = "baseline-repair-targets.json";

/** @type {readonly string[]} */
export const PROVEN_QA_FIXTURE_ZONE_NAMES = [
  "QA_Patch2_BookingZone_1786005355558",
  "QA_booking_lifecycle_zone_v1",
  "QA_Patch2_BookingZone_1786005389666",
];

/** Exact leaked zone from provider-eligibility E2E — v2 repair allowlist only. */
export const LEAKED_QA_FIXTURE_ZONE_NAME = "QA_Patch2_Zone_1786019593554";

/** @type {readonly string[]} */
export const BASELINE_REPAIR_V2_ZONE_NAMES = [
  ...PROVEN_QA_FIXTURE_ZONE_NAMES,
  LEAKED_QA_FIXTURE_ZONE_NAME,
];

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

/**
 * @param {string | null | undefined} projectRef
 */
export function maskProjectRef(projectRef) {
  if (!projectRef || projectRef.length < 12) return "****";
  return `${projectRef.slice(0, 4)}…${projectRef.slice(-4)}`;
}

/**
 * @param {unknown} left
 * @param {unknown} right
 */
export function valuesDeepEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

/**
 * @param {unknown} value
 */
function stableJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((row) => stableJson(row)).join(",")}]`;
  }
  const keys = Object.keys(/** @type {Record<string, unknown>} */ (value)).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(/** @type {Record<string, unknown>} */ (value)[key])}`).join(",")}}`;
}

/**
 * @param {string} [cwd]
 */
export function baselineRepairManifestPath(cwd = process.cwd()) {
  return path.resolve(cwd, "qa/report", BASELINE_REPAIR_MANIFEST_FILENAME);
}

/**
 * @param {unknown} manifest
 * @returns {{ ok: true; manifest: {
 *   generatedAt?: string;
 *   projectRef: string;
 *   settingsKeys: string[];
 *   zones: Array<{ id: string; name: string }>;
 * }} | { ok: false; reason: string }}
 */
export function validateBaselineRepairManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, reason: "manifest-missing-or-invalid" };
  }

  const row = /** @type {Record<string, unknown>} */ (manifest);
  const projectRef = typeof row.projectRef === "string" ? row.projectRef : "";
  if (projectRef !== KNOWN_QA_PROJECT_REF) {
    return { ok: false, reason: "manifest-project-ref-mismatch" };
  }

  const settingsKeys = Array.isArray(row.settingsKeys) ? row.settingsKeys.map(String) : [];
  const expectedSettings = [...REQUIRED_SETTINGS_KEYS].sort();
  const actualSettings = [...settingsKeys].sort();
  if (actualSettings.length !== expectedSettings.length
    || !actualSettings.every((key, index) => key === expectedSettings[index])) {
    return { ok: false, reason: "manifest-settings-keys-invalid" };
  }

  const zonesRaw = Array.isArray(row.zones) ? row.zones : [];
  const expectedZoneCount = BASELINE_REPAIR_V2_ZONE_NAMES.length;
  if (zonesRaw.length !== expectedZoneCount) {
    return { ok: false, reason: "manifest-zone-count-invalid" };
  }

  /** @type {Array<{ id: string; name: string }>} */
  const zones = [];
  const seenIds = new Set();
  const seenNames = new Set();

  for (const entry of zonesRaw) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, reason: "manifest-zone-invalid" };
    }
    const zone = /** @type {Record<string, unknown>} */ (entry);
    const id = typeof zone.id === "string" ? zone.id : "";
    const name = typeof zone.name === "string" ? zone.name : "";
    if (!UUID_RE.test(id)) {
      return { ok: false, reason: "manifest-zone-id-invalid" };
    }
    if (!name.startsWith("QA_")) {
      return { ok: false, reason: "manifest-zone-non-qa" };
    }
    if (seenIds.has(id) || seenNames.has(name)) {
      return { ok: false, reason: "manifest-zone-duplicate" };
    }
    seenIds.add(id);
    seenNames.add(name);
    zones.push({ id, name });
  }

  const allowedNames = new Set(BASELINE_REPAIR_V2_ZONE_NAMES);
  const manifestNames = new Set(zones.map((zone) => zone.name));
  if (manifestNames.size !== allowedNames.size
    || ![...allowedNames].every((name) => manifestNames.has(name))) {
    return { ok: false, reason: "manifest-zone-names-mismatch" };
  }

  return {
    ok: true,
    manifest: {
      generatedAt: typeof row.generatedAt === "string" ? row.generatedAt : undefined,
      projectRef,
      settingsKeys: [...REQUIRED_SETTINGS_KEYS],
      zones: zones.sort((a, b) => a.id.localeCompare(b.id)),
    },
  };
}

/**
 * @param {string} manifestPath
 */
export function loadBaselineRepairManifest(manifestPath = baselineRepairManifestPath()) {
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, reason: "manifest-file-missing" };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return validateBaselineRepairManifest(parsed);
  } catch {
    return { ok: false, reason: "manifest-parse-error" };
  }
}

/**
 * @param {string} key
 * @param {Array<{ key?: string; value?: unknown }>} rows
 */
export function planSettingBaselineAction(key) {
  const canonicalValue = CANONICAL_BASELINE_SETTINGS[key];
  return (rows) => {
    if (rows.length > 1) {
      return { blocked: true, reason: `duplicate-settings-${key}` };
    }
    if (rows.length === 0) {
      return {
        actionType: "insert_setting",
        key,
        beforeState: "absent",
        beforeValue: null,
        intendedValue: canonicalValue,
      };
    }
    const existing = rows[0]?.value;
    if (!valuesDeepEqual(existing, canonicalValue)) {
      return { blocked: true, reason: `conflicting-settings-${key}` };
    }
    return {
      actionType: "noop",
      key,
      beforeState: "present",
      beforeValue: existing,
      intendedValue: canonicalValue,
    };
  };
}

/**
 * @param {{ id: string; name: string }} manifestZone
 * @param {{ id: string; name_en: string; is_active: boolean } | null | undefined} liveRow
 */
export function planZoneBaselineAction(manifestZone, liveRow) {
  if (!manifestZone.name.startsWith("QA_")) {
    return { blocked: true, reason: "non-qa-zone-name" };
  }
  if (!liveRow) {
    return { blocked: true, reason: `missing-zone-${manifestZone.name}` };
  }
  if (liveRow.id !== manifestZone.id) {
    return { blocked: true, reason: `zone-id-mismatch-${manifestZone.name}` };
  }
  if (liveRow.name_en !== manifestZone.name) {
    return { blocked: true, reason: `zone-name-mismatch-${manifestZone.name}` };
  }
  if (!liveRow.name_en.startsWith("QA_")) {
    return { blocked: true, reason: "non-qa-zone-live" };
  }
  if (liveRow.is_active) {
    return {
      actionType: "deactivate_zone",
      id: manifestZone.id,
      name: manifestZone.name,
      beforeIsActive: true,
      intendedIsActive: false,
    };
  }
  return {
    actionType: "noop",
    id: manifestZone.id,
    name: manifestZone.name,
    beforeIsActive: false,
    intendedIsActive: false,
  };
}

/**
 * @param {{
 *   projectRef: string;
 *   manifest: { settingsKeys: string[]; zones: Array<{ id: string; name: string }> };
 *   settingsByKey: Record<string, Array<{ key?: string; value?: unknown }>>;
 *   zonesById: Record<string, { id: string; name_en: string; is_active: boolean } | null>;
 * }} input
 */
export function buildBaselineRepairPlanFromSnapshot(input) {
  /** @type {string | null} */
  let blockedReason = null;
  /** @type {Array<{ key: string; beforeState: string; beforeValue: unknown; intendedValue: unknown; actionType: string }>} */
  const settingActions = [];
  /** @type {Array<{ id: string; name: string; beforeIsActive: boolean | null; intendedIsActive: boolean; actionType: string; maskedId: string }>} */
  const zoneActions = [];

  if (input.projectRef !== KNOWN_QA_PROJECT_REF) {
    return finalizeBaselineRepairPlan({
      projectRef: input.projectRef,
      manifest: input.manifest,
      blockedReason: "project-ref-not-qa",
      settingActions: [],
      zoneActions: [],
    });
  }

  for (const key of [...REQUIRED_SETTINGS_KEYS].sort()) {
    const planner = planSettingBaselineAction(key);
    const result = planner(input.settingsByKey[key] ?? []);
    if ("blocked" in result && result.blocked) {
      blockedReason = result.reason ?? "settings-blocked";
      break;
    }
    settingActions.push({
      key: result.key,
      beforeState: result.beforeState,
      beforeValue: result.beforeValue,
      intendedValue: result.intendedValue,
      actionType: result.actionType,
    });
  }

  if (!blockedReason) {
    for (const manifestZone of [...input.manifest.zones].sort((a, b) => a.id.localeCompare(b.id))) {
      const result = planZoneBaselineAction(manifestZone, input.zonesById[manifestZone.id] ?? null);
      if ("blocked" in result && result.blocked) {
        blockedReason = result.reason ?? "zone-blocked";
        break;
      }
      zoneActions.push({
        id: result.id,
        name: result.name,
        beforeIsActive: result.beforeIsActive,
        intendedIsActive: result.intendedIsActive,
        actionType: result.actionType,
        maskedId: maskUserId(result.id),
      });
    }
  }

  const mutatingSettings = settingActions.filter((row) => row.actionType !== "noop");
  const mutatingZones = zoneActions.filter((row) => row.actionType !== "noop");
  const maxZoneMutations = input.manifest.zones.length === BASELINE_REPAIR_V2_ZONE_NAMES.length ? 1 : 3;
  if (!blockedReason && (mutatingSettings.length > 2 || mutatingZones.length > maxZoneMutations)) {
    blockedReason = "scope-exceeds-authorized-targets";
  }
  if (!blockedReason && settingActions.some((row) => !REQUIRED_SETTINGS_KEYS.includes(row.key))) {
    blockedReason = "unexpected-settings-target";
  }

  return finalizeBaselineRepairPlan({
    projectRef: input.projectRef,
    manifest: input.manifest,
    blockedReason,
    settingActions,
    zoneActions,
  });
}

/**
 * @param {{
 *   projectRef: string;
 *   manifest: { settingsKeys: string[]; zones: Array<{ id: string; name: string }> };
 *   blockedReason: string | null;
 *   settingActions: Array<{ key: string; beforeState: string; beforeValue: unknown; intendedValue: unknown; actionType: string }>;
 *   zoneActions: Array<{ id: string; name: string; beforeIsActive: boolean | null; intendedIsActive: boolean; actionType: string; maskedId: string }>;
 * }} input
 */
export function finalizeBaselineRepairPlan(input) {
  const blocked = Boolean(input.blockedReason);
  const manifestHash = hashBaselineRepairManifestIdentity({
    projectRef: input.projectRef,
    settingsKeys: input.manifest.settingsKeys,
    zones: input.manifest.zones,
  });
  const fingerprintPayload = {
    projectRef: input.projectRef,
    blocked,
    blockedReason: input.blockedReason,
    manifestHash,
    settings: input.settingActions.map((row) => ({
      key: row.key,
      beforeState: row.beforeState,
      beforeValue: row.beforeValue,
      intendedValue: row.intendedValue,
      actionType: row.actionType,
    })),
    zones: input.zoneActions.map((row) => ({
      id: row.id,
      name: row.name,
      beforeIsActive: row.beforeIsActive,
      intendedIsActive: row.intendedIsActive,
      actionType: row.actionType,
    })),
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
      planned_mutations: input.settingActions.filter((row) => row.actionType !== "noop").length
        + input.zoneActions.filter((row) => row.actionType !== "noop").length,
    },
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 */
export async function readSettingsRowsForBaseline(admin) {
  /** @type {Record<string, Array<{ key?: string; value?: unknown }>>} */
  const settingsByKey = {};
  for (const key of REQUIRED_SETTINGS_KEYS) {
    const { data, error } = await admin.from("settings").select("key,value").eq("key", key);
    if (error) {
      throw new Error(`[qa-baseline-repair] failed to read settings key ${key}: ${error.message}`);
    }
    settingsByKey[key] = data ?? [];
  }
  return settingsByKey;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {Array<{ id: string; name: string }>} manifestZones
 */
export async function readManifestZonesForBaseline(admin, manifestZones) {
  /** @type {Record<string, { id: string; name_en: string; is_active: boolean } | null>} */
  const zonesById = {};
  for (const manifestZone of manifestZones) {
    const { data, error } = await admin
      .from("zones")
      .select("id,name_en,is_active")
      .eq("id", manifestZone.id)
      .maybeSingle();
    if (error) {
      throw new Error(`[qa-baseline-repair] failed to read zone ${manifestZone.name}: ${error.message}`);
    }
    zonesById[manifestZone.id] = data
      ? { id: data.id, name_en: data.name_en, is_active: Boolean(data.is_active) }
      : null;
  }
  return zonesById;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} projectRef
 * @param {{ settingsKeys: string[]; zones: Array<{ id: string; name: string }> }} manifest
 */
export async function buildBaselineRepairPlanFromAdmin(admin, projectRef, manifest) {
  const settingsByKey = await readSettingsRowsForBaseline(admin);
  const zonesById = await readManifestZonesForBaseline(admin, manifest.zones);
  return buildBaselineRepairPlanFromSnapshot({
    projectRef,
    manifest,
    settingsByKey,
    zonesById,
  });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 */
export async function discoverBaselineRepairTargets(admin) {
  const { data, error } = await admin
    .from("zones")
    .select("id,name_en,is_active")
    .in("name_en", [...BASELINE_REPAIR_V2_ZONE_NAMES]);
  if (error) {
    throw new Error(`[qa-baseline-repair] failed to discover QA fixture zones: ${error.message}`);
  }

  const found = data ?? [];
  const byName = new Map(found.map((row) => [row.name_en, row]));
  /** @type {Array<{ id: string; name: string }>} */
  const zones = [];

  for (const name of BASELINE_REPAIR_V2_ZONE_NAMES) {
    const row = byName.get(name);
    if (!row) {
      throw new Error(`[qa-baseline-repair] missing approved QA zone: ${name}`);
    }
    if (!name.startsWith("QA_")) {
      throw new Error(`[qa-baseline-repair] non-QA zone name in discovery: ${name}`);
    }
    zones.push({ id: row.id, name: row.name_en });
  }

  if (zones.length !== BASELINE_REPAIR_V2_ZONE_NAMES.length) {
    throw new Error(`[qa-baseline-repair] expected exactly ${BASELINE_REPAIR_V2_ZONE_NAMES.length} approved QA zones; found ${zones.length}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    projectRef: KNOWN_QA_PROJECT_REF,
    settingsKeys: [...REQUIRED_SETTINGS_KEYS],
    zones: zones.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * @param {ReturnType<typeof discoverBaselineRepairTargets> extends Promise<infer P> ? P : never} manifest
 * @param {string} [manifestPath]
 */
export function writeBaselineRepairManifest(manifest, manifestPath = baselineRepairManifestPath()) {
  const validated = validateBaselineRepairManifest(manifest);
  if (!validated.ok) {
    throw new Error(`[qa-baseline-repair] refused to write invalid manifest: ${validated.reason}`);
  }
  const payload = {
    generatedAt: typeof manifest.generatedAt === "string" ? manifest.generatedAt : new Date().toISOString(),
    ...validated.manifest,
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return manifestPath;
}

/**
 * @param {ReturnType<typeof finalizeBaselineRepairPlan>} plan
 */
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
      beforeIsActive: row.beforeIsActive,
      intendedIsActive: row.intendedIsActive,
      actionType: row.actionType,
    })),
    protectedCatalog: plan.protectedCatalog ?? null,
  };
}

/**
 * @param {ReturnType<typeof finalizeBaselineRepairPlan>} freshPlan
 * @param {string | undefined} expectedFingerprint
 */
export function assertBaselineRepairPlanApproved(freshPlan, expectedFingerprint) {
  if (freshPlan.blocked) {
    throw new Error(`[qa-baseline-repair] plan blocked: ${freshPlan.blockedReason ?? "unknown"}`);
  }
  if (freshPlan.version !== BASELINE_REPAIR_PLAN_VERSION) {
    throw new Error("[qa-baseline-repair] plan version mismatch — rebuild dry-run and re-approve");
  }
  if (!expectedFingerprint) {
    throw new Error("[qa-baseline-repair] execute requires --plan-fingerprint from dry-run");
  }
  if (expectedFingerprint === INVALIDATED_BASELINE_REPAIR_FINGERPRINT_V1) {
    throw new Error("[qa-baseline-repair] plan fingerprint invalidated — rebuild dry-run and re-approve");
  }
  if (freshPlan.fingerprint !== expectedFingerprint) {
    throw new Error("[qa-baseline-repair] plan fingerprint mismatch — rebuild dry-run and re-approve");
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 */
export async function verifyProtectedCatalogCounts(admin) {
  const { count: categoryCount, error: categoryError } = await admin
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  if (categoryError) {
    throw new Error(`[qa-baseline-repair] failed to count categories: ${categoryError.message}`);
  }

  const { count: seededServiceCount, error: serviceError } = await admin
    .from("services")
    .select("id", { count: "exact", head: true })
    .not("name_en", "ilike", "QA_%")
    .eq("is_active", true);
  if (serviceError) {
    throw new Error(`[qa-baseline-repair] failed to count seeded services: ${serviceError.message}`);
  }

  const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
  if (bucketError) {
    throw new Error(`[qa-baseline-repair] failed to list storage buckets: ${bucketError.message}`);
  }
  const bucketIds = new Set((buckets ?? []).map((row) => row.id));

  const ok = categoryCount === EXPECTED_ACTIVE_CATEGORY_COUNT
    && seededServiceCount === EXPECTED_SEEDED_NON_QA_SERVICE_COUNT
    && bucketIds.size === EXPECTED_STORAGE_BUCKET_COUNT
    && REQUIRED_STORAGE_BUCKETS.every((bucketId) => bucketIds.has(bucketId));

  return {
    ok,
    categoryCount,
    seededServiceCount,
    storageBucketCount: bucketIds.size,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {ReturnType<typeof finalizeBaselineRepairPlan>} plan
 */
export async function executeBaselineRepairPlan(admin, plan) {
  if (plan.blocked) {
    throw new Error(`[qa-baseline-repair] plan blocked: ${plan.blockedReason ?? "unknown"}`);
  }

  /** @type {Array<{ entityType: string; maskedId: string; actionType: string; ok: boolean; reason?: string }>} */
  const results = [];
  let mutationsStarted = false;

  const pushResult = (entry) => {
    results.push(entry);
  };

  for (const action of plan.settings) {
    if (action.actionType === "noop") continue;
    if (action.actionType !== "insert_setting") {
      pushResult({
        entityType: "setting",
        maskedId: action.key,
        actionType: action.actionType,
        ok: false,
        reason: "unexpected-setting-action",
      });
      continue;
    }
    mutationsStarted = true;
    const { error } = await admin.from("settings").insert({
      key: action.key,
      value: action.intendedValue,
    });
    pushResult({
      entityType: "setting",
      maskedId: action.key,
      actionType: action.actionType,
      ok: !error,
      reason: error?.message,
    });
    if (error) {
      return { success: false, mutationsStarted, results, verification: null };
    }
  }

  for (const action of plan.zones) {
    if (action.actionType === "noop") continue;
    if (action.actionType !== "deactivate_zone") {
      pushResult({
        entityType: "zone",
        maskedId: action.maskedId,
        actionType: action.actionType,
        ok: false,
        reason: "unexpected-zone-action",
      });
      continue;
    }
    mutationsStarted = true;
    const { error } = await admin.from("zones").update({ is_active: false }).eq("id", action.id);
    pushResult({
      entityType: "zone",
      maskedId: action.maskedId,
      actionType: action.actionType,
      ok: !error,
      reason: error?.message,
    });
    if (error) {
      return { success: false, mutationsStarted, results, verification: null };
    }
  }

  for (const action of plan.settings) {
    const { data, error } = await admin.from("settings").select("value").eq("key", action.key).maybeSingle();
    if (error || !data || !valuesDeepEqual(data.value, action.intendedValue)) {
      return {
        success: false,
        mutationsStarted,
        results,
        verification: { reason: `settings-readback-failed-${action.key}` },
      };
    }
  }

  for (const action of plan.zones) {
    const { data, error } = await admin.from("zones").select("is_active").eq("id", action.id).maybeSingle();
    if (error || !data || data.is_active !== false) {
      return {
        success: false,
        mutationsStarted,
        results,
        verification: { reason: `zone-readback-failed-${action.name}` },
      };
    }
  }

  const protectedCatalog = await verifyProtectedCatalogCounts(admin);
  const success = results.every((row) => row.ok) && protectedCatalog.ok;
  return {
    success,
    mutationsStarted,
    results,
    verification: { protectedCatalog },
  };
}
