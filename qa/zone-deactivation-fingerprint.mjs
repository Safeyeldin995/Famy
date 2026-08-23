import { createHash } from "node:crypto";

export const ZONE_DEACTIVATION_PLAN_VERSION = "issue-12-zone-deactivation-v1";

/**
 * @param {{
 *   projectRef: string;
 *   blocked: boolean;
 *   blockedReason?: string | null;
 *   zones: Array<{
 *     id: string;
 *     name_en: string;
 *     beforeIsActive: boolean | null;
 *     intendedIsActive: boolean;
 *     actionType: string;
 *     childCounts: { zone_services: number; zone_providers: number; addresses: number };
 *     expectedSpatialAddressCount: number;
 *     observedSpatialAddressCount: number;
 *   }>;
 * }} payload
 */
export function fingerprintZoneDeactivationPlan(payload) {
  const zones = [...payload.zones]
    .map((row) => ({
      id: row.id,
      name_en: row.name_en,
      beforeIsActive: row.beforeIsActive,
      intendedIsActive: row.intendedIsActive,
      actionType: row.actionType,
      childCounts: row.childCounts,
      expectedSpatialAddressCount: row.expectedSpatialAddressCount,
      observedSpatialAddressCount: row.observedSpatialAddressCount,
    }))
    .sort((a, b) => `${a.id}:${a.name_en}`.localeCompare(`${b.id}:${b.name_en}`));

  return createHash("sha256")
    .update(
      JSON.stringify({
        version: ZONE_DEACTIVATION_PLAN_VERSION,
        projectRef: payload.projectRef,
        blocked: payload.blocked,
        blockedReason: payload.blockedReason ?? null,
        zones,
      }),
    )
    .digest("hex");
}

/**
 * @param {Awaited<ReturnType<import("./zone-deactivation-planner.mjs").buildZoneDeactivationPlanFromAdmin>>} plan
 * @param {string | undefined} expectedFingerprint
 */
export function assertZoneDeactivationPlanApproved(plan, expectedFingerprint) {
  if (plan.blocked) {
    throw new Error(
      `[qa-zone-deactivation] Plan is blocked: ${plan.blockedReason ?? "unknown reason"}`,
    );
  }
  if (!plan.fingerprint) {
    throw new Error("[qa-zone-deactivation] Blocked plan has no fingerprint.");
  }
  if (!expectedFingerprint) {
    throw new Error(
      "[qa-zone-deactivation] Execute requires --plan-fingerprint from the preceding dry-run.",
    );
  }
  if (expectedFingerprint !== plan.fingerprint) {
    throw new Error("[qa-zone-deactivation] plan-fingerprint mismatch — re-run dry-run.");
  }
}
