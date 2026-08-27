import { createHash } from "node:crypto";

export const STALE_QA_SERVICES_PLAN_VERSION = "stale-inactive-qa-services-v2";

/**
 * @param {{
 *   projectRef: string;
 *   services: Array<{
 *     id: string;
 *     name_en: string;
 *     slug: string | null;
 *     bookingCount: number;
 *     deletableBookingCount: number;
 *     retainedBookingCount: number;
 *     deletable: boolean;
 *     retainReason?: string | null;
 *     dependentCounts: Record<string, number>;
 *   }>;
 *   deletions: Array<{
 *     table: string;
 *     phase: string;
 *     keyCount: number;
 *     resourceKey?: string | null;
 *   }>;
 *   retained: Array<{
 *     table: string;
 *     id: string;
 *     reason: string;
 *     phase?: string | null;
 *     resourceKey?: string | null;
 *   }>;
 *   overrideImmutableHistory?: boolean;
 *   immutableOverrideCounts?: {
 *     audit_logs: number;
 *     booking_cancellations: number;
 *     messages: number;
 *     conversations: number;
 *   };
 * }} payload
 */
export function fingerprintStaleQaServicesPlan(payload) {
  const services = [...payload.services]
    .map((row) => ({
      id: row.id,
      name_en: row.name_en,
      slug: row.slug,
      bookingCount: row.bookingCount,
      deletableBookingCount: row.deletableBookingCount,
      retainedBookingCount: row.retainedBookingCount,
      deletable: row.deletable,
      retainReason: row.retainReason ?? null,
      dependentCounts: row.dependentCounts,
    }))
    .sort((a, b) => `${a.id}:${a.name_en}`.localeCompare(`${b.id}:${b.name_en}`));

  const deletions = [...payload.deletions]
    .map((row) => ({
      table: row.table,
      phase: row.phase,
      keyCount: row.keyCount,
      resourceKey: row.resourceKey ?? null,
    }))
    .sort((a, b) =>
      `${a.phase}:${a.table}:${a.resourceKey ?? ""}:${a.keyCount}`.localeCompare(
        `${b.phase}:${b.table}:${b.resourceKey ?? ""}:${b.keyCount}`,
      ),
    );

  const retained = [...payload.retained]
    .map((row) => ({
      table: row.table,
      id: row.id,
      reason: row.reason,
      phase: row.phase ?? null,
      resourceKey: row.resourceKey ?? null,
    }))
    .sort((a, b) =>
      `${a.phase ?? ""}:${a.table}:${a.id}:${a.reason}`.localeCompare(
        `${b.phase ?? ""}:${b.table}:${b.id}:${b.reason}`,
      ),
    );

  return createHash("sha256")
    .update(
      JSON.stringify({
        version: STALE_QA_SERVICES_PLAN_VERSION,
        projectRef: payload.projectRef,
        overrideImmutableHistory: payload.overrideImmutableHistory ?? false,
        immutableOverrideCounts: payload.immutableOverrideCounts ?? {
          audit_logs: 0,
          booking_cancellations: 0,
          messages: 0,
          conversations: 0,
        },
        services,
        deletions,
        retained,
      }),
    )
    .digest("hex");
}

/**
 * @param {Awaited<ReturnType<import("./stale-qa-services-planner.mjs").buildStaleQaServicesPlanFromAdmin>>} plan
 * @param {string | undefined} expectedFingerprint
 */
export function assertStaleQaServicesPlanApproved(plan, expectedFingerprint) {
  if (!plan.fingerprint) {
    throw new Error("[qa-stale-services] Plan has no fingerprint.");
  }
  if (!expectedFingerprint) {
    throw new Error(
      "[qa-stale-services] Execute requires --plan-fingerprint from the preceding dry-run.",
    );
  }
  if (expectedFingerprint !== plan.fingerprint) {
    throw new Error("[qa-stale-services] plan-fingerprint mismatch — re-run dry-run.");
  }
}
