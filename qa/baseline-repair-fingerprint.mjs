import { createHash } from "node:crypto";

export const BASELINE_REPAIR_PLAN_VERSION = "6a.2-baseline-repair-v1";

/**
 * @param {{
 *   projectRef: string;
 *   blocked: boolean;
 *   blockedReason?: string | null;
 *   manifestHash: string;
 *   settings: Array<{
 *     key: string;
 *     beforeState: string;
 *     beforeValue: unknown;
 *     intendedValue: unknown;
 *     actionType: string;
 *   }>;
 *   zones: Array<{
 *     id: string;
 *     name: string;
 *     beforeIsActive: boolean | null;
 *     intendedIsActive: boolean;
 *     actionType: string;
 *   }>;
 * }} payload
 */
export function fingerprintBaselineRepairPlan(payload) {
  const settings = [...payload.settings]
    .map((row) => ({
      key: row.key,
      beforeState: row.beforeState,
      beforeValue: row.beforeValue,
      intendedValue: row.intendedValue,
      actionType: row.actionType,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const zones = [...payload.zones]
    .map((row) => ({
      id: row.id,
      name: row.name,
      beforeIsActive: row.beforeIsActive,
      intendedIsActive: row.intendedIsActive,
      actionType: row.actionType,
    }))
    .sort((a, b) => `${a.id}:${a.name}`.localeCompare(`${b.id}:${b.name}`));

  return createHash("sha256").update(JSON.stringify({
    version: BASELINE_REPAIR_PLAN_VERSION,
    projectRef: payload.projectRef,
    blocked: payload.blocked,
    blockedReason: payload.blockedReason ?? null,
    manifestHash: payload.manifestHash,
    settings,
    zones,
  })).digest("hex");
}

/**
 * @param {{
 *   projectRef: string;
 *   settingsKeys: string[];
 *   zones: Array<{ id: string; name: string }>;
 * }} manifest
 */
export function hashBaselineRepairManifestIdentity(manifest) {
  const canonical = {
    projectRef: manifest.projectRef,
    settingsKeys: [...manifest.settingsKeys].sort(),
    zones: [...manifest.zones]
      .map((row) => ({ id: row.id, name: row.name }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
