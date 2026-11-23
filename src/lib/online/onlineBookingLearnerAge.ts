import { memberAgeFromDate } from "../familyMemberAge";

export const ONLINE_BOOKING_MIN_AGE_YEARS = 12;

export type OnlineLearnerAgeIssue = "birth_date_required" | "age_minimum";

export function onlineBookingLearnerAgeIssue(
  forWhom: string,
  profileDateOfBirth: string | null | undefined,
  familyMembers: { id: string; date_of_birth: string }[],
): OnlineLearnerAgeIssue | null {
  const dob =
    forWhom === "myself"
      ? profileDateOfBirth
      : familyMembers.find((m) => m.id === forWhom)?.date_of_birth;
  if (!dob) return "birth_date_required";
  const age = memberAgeFromDate(dob);
  if (!age || age.years < ONLINE_BOOKING_MIN_AGE_YEARS) return "age_minimum";
  return null;
}