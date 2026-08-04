/**
 * Sanctioned booking terminalization contract for QA operational containment.
 * Authoritative production path: public.cancel_booking(p_booking_id, p_reason_id, p_note)
 */

export const CONTAINMENT_PLAN_VERSION = "6a.2-containment-v3";

/** Statuses treated as active operational residue by verify-residue.mjs */
export const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "in_progress"];

/** Terminal booking statuses that require no containment action. */
export const TERMINAL_BOOKING_STATUSES = ["cancelled", "completed", "no_show"];

/** Admin-managed reason used for QA containment cancellations. */
export const QA_CONTAINMENT_REASON_CODE = "admin_other";

export const QA_CONTAINMENT_NOTE = "QA operational containment";

/**
 * @typedef {{
 *   id: string;
 *   status: string;
 *   notes?: string | null;
 *   hasCancellationRecord?: boolean;
 *   isQaTagged?: boolean;
 * }} BookingContainmentInput
 */

/**
 * @param {BookingContainmentInput} booking
 */
export function planBookingContainmentAction(booking) {
  if (!booking.isQaTagged) {
    return { actionType: "skip", reason: "not-qa-booking" };
  }

  if (TERMINAL_BOOKING_STATUSES.includes(booking.status)) {
    return { actionType: "noop", reason: "already-terminal", resultingStatus: booking.status };
  }

  if (booking.hasCancellationRecord) {
    return { actionType: "noop", reason: "cancellation-record-exists", resultingStatus: booking.status };
  }

  if (!["pending", "confirmed"].includes(booking.status)) {
    return {
      actionType: "blocked",
      reason: "requires-dispute-or-no-show-path",
      rpc: null,
      allowedSourceStatuses: ["on_the_way", "arrived", "arrival_confirmed", "in_progress", "completion_requested"],
      resultingStatus: null,
    };
  }

  return {
    actionType: "cancel_booking",
    rpc: "cancel_booking",
    args: {
      p_booking_id: booking.id,
      p_reason_code: QA_CONTAINMENT_REASON_CODE,
      p_note: QA_CONTAINMENT_NOTE,
    },
    allowedSourceStatuses: ["pending", "confirmed"],
    resultingStatus: "cancelled",
    authorization: "authenticated admin, customer, or provider on the booking",
    idempotency: "not-idempotent-on-repeat; noop when cancellation record already exists",
    preservesImmutableHistory: true,
  };
}

/**
 * @param {string | null | undefined} notes
 */
export function isQaTaggedBookingNotes(notes) {
  return typeof notes === "string" && /^QA[\s_]/i.test(notes);
}
