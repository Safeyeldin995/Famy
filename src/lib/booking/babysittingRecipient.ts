import { ageInWholeMonthsUtc, childAgeMonthsInSupportedRange } from "@/lib/booking/childAgeMonths";

export type BookingFamilyMember = {
  id: string;
  full_name?: string | null;
  date_of_birth?: string | null;
  is_active?: boolean | null;
};

export function isBabysittingCategorySlug(slug: string | null | undefined): boolean {
  return slug === "babysitting";
}

export function defaultForWhom(isBabysitting: boolean): string {
  return isBabysitting ? "" : "myself";
}

export function showMyselfOption(isBabysitting: boolean): boolean {
  return !isBabysitting;
}

export function familyMemberSelectableForBabysitting(
  member: BookingFamilyMember,
  startAt: string | Date | null,
): { ok: boolean; reason?: "missing_dob" | "out_of_range" } {
  if (!member.date_of_birth) return { ok: false, reason: "missing_dob" };
  if (!startAt) return { ok: true };
  const months = ageInWholeMonthsUtc(member.date_of_birth, startAt);
  if (!childAgeMonthsInSupportedRange(months)) return { ok: false, reason: "out_of_range" };
  return { ok: true };
}

export function canContinueForWhom(input: {
  isBabysitting: boolean;
  forWhom: string;
  members: BookingFamilyMember[];
  startAt: string | Date | null;
}): boolean {
  if (!input.isBabysitting) {
    return (
      input.forWhom === "myself" || input.members.some((member) => member.id === input.forWhom)
    );
  }
  const member = input.members.find((row) => row.id === input.forWhom);
  if (!member) return false;
  return familyMemberSelectableForBabysitting(member, input.startAt).ok;
}

export function bookingFamilyMemberId(forWhom: string): string | null {
  return forWhom === "myself" || forWhom === "" ? null : forWhom;
}
