import { createHash } from "node:crypto";
import { CONTAINMENT_PLAN_VERSION } from "./containment-booking-lifecycle.mjs";

/**
 * @param {Array<{ entityType: string; id: string; actionType: string; currentState: unknown; intendedState: unknown }>} actions
 * @param {string} projectRef
 * @param {{
 *   bookingCallerUserId?: string | null;
 *   bookingCallerClass?: string | null;
 *   callerAuthMode?: string | null;
 *   bookingCallerSelectionPolicy?: string | null;
 *   eligibleCallerCount?: number | null;
 *   cancellationReasonId?: string | null;
 *   bookings?: Array<{ id: string; status: string }>;
 * }} [metadata]
 */
export function fingerprintContainmentPlan(actions, projectRef, metadata = {}) {
  const canonical = actions
    .map((row) => ({
      entityType: row.entityType,
      id: row.id,
      actionType: row.actionType,
      currentState: row.currentState,
      intendedState: row.intendedState,
    }))
    .sort((a, b) => {
      const keyA = `${a.entityType}:${a.id}:${a.actionType}`;
      const keyB = `${b.entityType}:${b.id}:${b.actionType}`;
      return keyA.localeCompare(keyB);
    });

  const bookings = (metadata.bookings ?? [])
    .map((row) => ({ id: row.id, status: row.status }))
    .sort((a, b) => `${a.id}:${a.status}`.localeCompare(`${b.id}:${b.status}`));

  return createHash("sha256").update(JSON.stringify({
    version: CONTAINMENT_PLAN_VERSION,
    projectRef,
    bookingCallerUserId: metadata.bookingCallerUserId ?? null,
    bookingCallerClass: metadata.bookingCallerClass ?? null,
    callerAuthMode: metadata.callerAuthMode ?? null,
    bookingCallerSelectionPolicy: metadata.bookingCallerSelectionPolicy ?? null,
    eligibleCallerCount: metadata.eligibleCallerCount ?? null,
    cancellationReasonId: metadata.cancellationReasonId ?? null,
    bookings,
    actions: canonical,
  })).digest("hex");
}

/** Prior v1 fingerprint — must never match v3 plans. */
export const INVALIDATED_CONTAINMENT_FINGERPRINT_V1 = "b93a81048c5677319c863653fa3673fc942d092cbac32da02f3537047fa28ccf";

/** Prior v2 fingerprint — must never match v4 plans. */
export const INVALIDATED_CONTAINMENT_FINGERPRINT_V2 = "2034db204e41b531ff0baf69d9173b41e03a8236721b2752bd0fcdae6080acb6";
