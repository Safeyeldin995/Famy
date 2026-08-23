import {
  fingerprintZoneDeactivationPlan,
  ZONE_DEACTIVATION_PLAN_VERSION,
} from "./zone-deactivation-fingerprint.mjs";
import { maskUserId } from "./qa-classification.mjs";
import { readZoneChildCounts } from "./baseline-repair-planner.mjs";

/**
 * Fixed Issue #12 residue zones — may verify these tuples only; never broaden.
 */
export const ZONE_DEACTIVATION_V1_TARGETS = Object.freeze([
  {
    id: "16079e5f-b915-4afa-aa64-2b5a40bd6597",
    name_en: "QA_booking_lifecycle_zone_v1",
    expectedSpatialAddressCount: 52,
    provenanceOwner: "booking-lifecycle-fixtures.mjs",
  },
  {
    id: "325e3a13-1355-4cde-84ff-9a396f305691",
    name_en: "QA_status_selector_zone_1786617970885",
    expectedSpatialAddressCount: 10,
    provenanceOwner: "admin-audit-fixes.spec.ts",
  },
]);

export function maskProjectRef(projectRef) {
  if (!projectRef || projectRef.length < 12) return "****";
  return `${projectRef.slice(0, 4)}…${projectRef.slice(-4)}`;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {typeof ZONE_DEACTIVATION_V1_TARGETS[number]} target
 */
async function readZoneTargetState(admin, target) {
  const { data, error } = await admin
    .from("zones")
    .select("id,name_en,is_active")
    .eq("id", target.id)
    .maybeSingle();
  if (error) {
    throw new Error(
      `[qa-zone-deactivation] failed to read zone ${target.name_en}: ${error.message}`,
    );
  }
  const childCounts = await readZoneChildCounts(admin, target.id);
  return { row: data, childCounts };
}

/**
 * @param {{
 *   projectRef: string;
 *   zonesById: Record<string, Awaited<ReturnType<typeof readZoneTargetState>>>;
 * }} snapshot
 */
export function buildZoneDeactivationPlanFromSnapshot(snapshot) {
  /** @type {string | null} */
  let blockedReason = null;
  const zones = [];

  for (const target of ZONE_DEACTIVATION_V1_TARGETS) {
    const live = snapshot.zonesById[target.id];
    const row = live?.row;
    const childCounts = live?.childCounts ?? {
      zone_services: null,
      zone_providers: null,
      addresses: null,
    };
    const observedSpatialAddressCount = childCounts.addresses ?? -1;

    if (!row) {
      blockedReason = blockedReason ?? `missing-zone:${target.name_en}`;
    } else if (row.id !== target.id || row.name_en !== target.name_en) {
      blockedReason = blockedReason ?? `zone-identity-mismatch:${target.name_en}`;
    } else if (!row.is_active) {
      blockedReason = blockedReason ?? `zone-already-inactive:${target.name_en}`;
    } else if ((childCounts.zone_services ?? -1) !== 0 || (childCounts.zone_providers ?? -1) !== 0) {
      blockedReason =
        blockedReason ??
        `zone-has-fk-children:${target.name_en}:services=${childCounts.zone_services}:providers=${childCounts.zone_providers}`;
    } else if (observedSpatialAddressCount !== target.expectedSpatialAddressCount) {
      blockedReason =
        blockedReason ??
        `spatial-address-count-drift:${target.name_en}:expected=${target.expectedSpatialAddressCount}:observed=${observedSpatialAddressCount}`;
    }

    zones.push({
      id: target.id,
      name_en: target.name_en,
      maskedId: maskUserId(target.id),
      provenanceOwner: target.provenanceOwner,
      beforeIsActive: row?.is_active ?? null,
      intendedIsActive: false,
      actionType: "deactivate_zone",
      childCounts: {
        zone_services: childCounts.zone_services ?? -1,
        zone_providers: childCounts.zone_providers ?? -1,
        addresses: observedSpatialAddressCount,
      },
      expectedSpatialAddressCount: target.expectedSpatialAddressCount,
      observedSpatialAddressCount,
    });
  }

  const blocked = Boolean(blockedReason);
  const fingerprint = blocked
    ? null
    : fingerprintZoneDeactivationPlan({
        projectRef: snapshot.projectRef,
        blocked: false,
        zones,
      });

  return {
    version: ZONE_DEACTIVATION_PLAN_VERSION,
    maskedProjectRef: maskProjectRef(snapshot.projectRef),
    blocked,
    blockedReason,
    fingerprint,
    zones,
    counts: {
      zone_targets: zones.length,
      planned_mutations: blocked ? 0 : zones.length,
    },
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} projectRef
 */
export async function buildZoneDeactivationPlanFromAdmin(admin, projectRef) {
  /** @type {Record<string, Awaited<ReturnType<typeof readZoneTargetState>>>} */
  const zonesById = {};
  for (const target of ZONE_DEACTIVATION_V1_TARGETS) {
    zonesById[target.id] = await readZoneTargetState(admin, target);
  }
  return buildZoneDeactivationPlanFromSnapshot({ projectRef, zonesById });
}

/**
 * @param {Awaited<ReturnType<typeof buildZoneDeactivationPlanFromAdmin>>} plan
 */
export function sanitizeZoneDeactivationPlanForReport(plan) {
  return {
    version: plan.version,
    maskedProjectRef: plan.maskedProjectRef,
    blocked: plan.blocked,
    blockedReason: plan.blockedReason,
    fingerprint: plan.fingerprint,
    counts: plan.counts,
    zones: plan.zones,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {Awaited<ReturnType<typeof buildZoneDeactivationPlanFromAdmin>>} plan
 */
export async function executeZoneDeactivationPlan(admin, plan) {
  /** @type {Array<{ entityType: string; maskedId: string; actionType: string; ok: boolean; error?: string }>} */
  const results = [];

  for (const zone of plan.zones) {
    const { error } = await admin.from("zones").update({ is_active: false }).eq("id", zone.id);
    results.push({
      entityType: "zones",
      maskedId: zone.maskedId,
      actionType: zone.actionType,
      ok: !error,
      error: error?.message,
    });
    if (error) break;
  }

  return {
    success: results.every((row) => row.ok),
    mutationsStarted: results.length > 0,
    results,
  };
}
