import { createHash } from "node:crypto";

export const BASELINE_REPAIR_PLAN_VERSION = "6a.2-baseline-repair-v4";

/** Prior v1 fingerprint — must never match v2 plans. */
export const INVALIDATED_BASELINE_REPAIR_FINGERPRINT_V1 =
  "a134ef1e662941204d786446665a77e5d594462816b5df8b5d295e98fe2376e2";

/** Reviewed v2 fingerprint. V3 must always reject it, even if live state happens to hash similarly. */
export const INVALIDATED_BASELINE_REPAIR_FINGERPRINT_V2 =
  "0144e092b9543f76666a5dba4002bdcbf3227ad5fe06ee56ac1600226c52c314";

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
 *     provenanceOwner: string;
 *     provenanceClass: string;
 *     childCounts: { zone_services: number; zone_providers: number; addresses: number };
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
      provenanceOwner: row.provenanceOwner,
      provenanceClass: row.provenanceClass,
      childCounts: row.childCounts,
    }))
    .sort((a, b) => `${a.id}:${a.name}`.localeCompare(`${b.id}:${b.name}`));

  return createHash("sha256")
    .update(
      JSON.stringify({
        version: BASELINE_REPAIR_PLAN_VERSION,
        projectRef: payload.projectRef,
        blocked: payload.blocked,
        blockedReason: payload.blockedReason ?? null,
        manifestHash: payload.manifestHash,
        settings,
        zones,
      }),
    )
    .digest("hex");
}

/**
 * @param {{
 *   projectRef: string;
 *   settingsKeys: string[];
 *   zones: Array<{ id: string; name: string; provenanceOwner?: string; provenanceClass?: string }>;
 * }} manifest
 */
export function hashBaselineRepairManifestIdentity(manifest) {
  const canonical = {
    projectRef: manifest.projectRef,
    settingsKeys: [...manifest.settingsKeys].sort(),
    zones: [...manifest.zones]
      .map((row) => ({
        id: row.id,
        name: row.name,
        provenanceOwner: row.provenanceOwner ?? null,
        provenanceClass: row.provenanceClass ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
