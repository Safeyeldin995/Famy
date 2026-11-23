import { memberAgeFromDate, memberToday } from "../familyMemberAge";

export function familyMemberIsMinor(
  dateOfBirth: string | null | undefined,
  today = memberToday(),
): boolean {
  const age = dateOfBirth ? memberAgeFromDate(dateOfBirth, today) : null;
  if (!age) return false;
  return age.years < 18;
}

/** Online bookings for a child family member require explicit guardian consent at checkout. */
export function requiresOnlineGuardianConsent(input: {
  serviceMode: "in_person" | "online";
  forWhom: string;
  familyMemberDateOfBirth: string | null | undefined;
}): boolean {
  if (input.serviceMode !== "online") return false;
  if (!input.forWhom || input.forWhom === "myself") return false;
  return familyMemberIsMinor(input.familyMemberDateOfBirth);
}