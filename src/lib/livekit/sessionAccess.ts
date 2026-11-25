export type SessionJoinParty = "customer" | "provider";

export type SessionBookingSnapshot = {
  id: string;
  service_mode: string;
  status: string;
  customer_id: string;
  provider_id: string;
  provider_profile_id: string;
  start_at: string;
  end_at: string;
  payment_captured: boolean;
};

/**
 * Same predicate the server uses before issuing a room token: only a captured
 * online or manual-transfer payment lets a participant join. A receipt still in
 * review holds money but does not unlock the room.
 */
export function paymentCapturedForJoin(
  p: { status?: string | null; payment_method_type?: string | null } | null | undefined,
): boolean {
  if (!p || p.status !== "captured") return false;
  return p.payment_method_type === "online" || p.payment_method_type === "manual_transfer";
}

const JOINABLE_STATUSES = new Set(["confirmed", "on_the_way", "arrived", "arrival_confirmed", "in_progress"]);

const PREJOIN_MS = 10 * 60 * 1000;
const POSTSESSION_MS = 15 * 60 * 1000;
const LESSON_REPORT_POSTSESSION_MS = 24 * 60 * 60 * 1000;

export function sessionJoinWindow(
  startAt: Date,
  endAt: Date,
  now: Date = new Date(),
): { open: boolean; opensAt: Date; closesAt: Date } {
  const opensAt = new Date(startAt.getTime() - PREJOIN_MS);
  const closesAt = new Date(endAt.getTime() + POSTSESSION_MS);
  const open = now >= opensAt && now <= closesAt;
  return { open, opensAt, closesAt };
}

export function sessionParticipantForUser(
  booking: Pick<SessionBookingSnapshot, "customer_id" | "provider_profile_id">,
  userId: string,
): SessionJoinParty | null {
  if (userId === booking.customer_id) return "customer";
  if (userId === booking.provider_profile_id) return "provider";
  return null;
}

export type SessionAuthorizeResult =
  | { ok: true; party: SessionJoinParty }
  | { ok: false; code: string };

export type SessionJoinCredentialInput =
  | { kind: "authenticated"; userId: string }
  | { kind: "session_code"; userId: string; party: SessionJoinParty };

/** Maps a credential to participant authorization (shared by bearer and future session codes). */
export function authorizeSessionJoinWithCredential(
  booking: SessionBookingSnapshot,
  credential: SessionJoinCredentialInput,
  now: Date = new Date(),
): SessionAuthorizeResult {
  const authz = authorizeSessionJoin(booking, credential.userId, now);
  if (!authz.ok) return authz;
  if (credential.kind === "session_code" && authz.party !== credential.party) {
    return { ok: false, code: "not_participant" };
  }
  return authz;
}

/** Pure authorization for LiveKit session token (Issue #396). */
export function authorizeSessionJoin(
  booking: SessionBookingSnapshot,
  userId: string,
  now: Date = new Date(),
): SessionAuthorizeResult {
  if (booking.service_mode !== "online") {
    return { ok: false, code: "not_online_booking" };
  }
  if (!JOINABLE_STATUSES.has(booking.status)) {
    return { ok: false, code: "booking_not_active" };
  }
  if (!booking.payment_captured) {
    return { ok: false, code: "payment_required" };
  }
  const party = sessionParticipantForUser(booking, userId);
  if (!party) {
    return { ok: false, code: "not_participant" };
  }
  const start = new Date(booking.start_at);
  const end = new Date(booking.end_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, code: "invalid_schedule" };
  }
  const { open } = sessionJoinWindow(start, end, now);
  if (!open) {
    return { ok: false, code: "outside_join_window" };
  }
  return { ok: true, party };
}

/** Online bookings accept only prepaid methods (card, wallets, approved InstaPay). */
export function isPrepaidPaymentMethodType(methodType: string | null | undefined): boolean {
  if (!methodType) return false;
  return methodType === "online" || methodType === "manual_transfer";
}

export function assertOnlineBookingPrepaid(methodType: string | null | undefined): void {
  if (methodType === "cash") {
    throw new Error("BOOKING_ONLINE_PREPAID_ONLY");
  }
  if (!isPrepaidPaymentMethodType(methodType)) {
    throw new Error("BOOKING_ONLINE_PREPAID_ONLY");
  }
}

export function onlineLessonReportWindow(
  startAt: Date,
  endAt: Date,
  now: Date = new Date(),
): { open: boolean; opensAt: Date; closesAt: Date } {
  const opensAt = new Date(startAt.getTime() - PREJOIN_MS);
  const closesAt = new Date(endAt.getTime() + LESSON_REPORT_POSTSESSION_MS);
  return { open: now >= opensAt && now <= closesAt, opensAt, closesAt };
}