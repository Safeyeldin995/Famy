import { memberAgeFromDate } from "../familyMemberAge";

export const ONLINE_BOOKING_MIN_AGE_YEARS = 12;

/** Stored on bookings.supervision_mode when a parent confirms supervising a child's online lesson. */
export const ONLINE_PARENT_SUPERVISION_MODE = "parent_online" as const;

/**
 * - birth_date_required: the learner has no date of birth yet.
 * - age_minimum: a student under 12 booking for themselves («أنا»); online stays 12+.
 * - parent_supervision_required: the parent is booking for their own child under 12; allowed
 *   once the parent confirms «هبقى موجود مع ابني أو متابع الحصة».
 */
export type OnlineLearnerAgeIssue =
  | "birth_date_required"
  | "age_minimum"
  | "parent_supervision_required";

export function onlineBookingLearnerAgeIssue(
  forWhom: string,
  profileDateOfBirth: string | null | undefined,
  familyMembers: { id: string; date_of_birth: string }[],
): OnlineLearnerAgeIssue | null {
  const forSelf = forWhom === "myself";
  const dob = forSelf
    ? profileDateOfBirth
    : familyMembers.find((m) => m.id === forWhom)?.date_of_birth;
  if (!dob) return "birth_date_required";
  const age = memberAgeFromDate(dob);
  if (!age || age.years < ONLINE_BOOKING_MIN_AGE_YEARS) {
    return forSelf ? "age_minimum" : "parent_supervision_required";
  }
  return null;
}

/** True when the learner can book: no issue, or a child under 12 whose parent confirmed. */
export function onlineLearnerReady(
  issue: OnlineLearnerAgeIssue | null,
  parentSupervisionConfirmed: boolean,
): boolean {
  if (issue === null) return true;
  return issue === "parent_supervision_required" && parentSupervisionConfirmed;
}

/** supervision_mode to send with an online booking. */
export function onlineBookingSupervisionMode(
  issue: OnlineLearnerAgeIssue | null,
  parentSupervisionConfirmed: boolean,
): typeof ONLINE_PARENT_SUPERVISION_MODE | null {
  return issue === "parent_supervision_required" && parentSupervisionConfirmed
    ? ONLINE_PARENT_SUPERVISION_MODE
    : null;
}
