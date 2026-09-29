/** Babysitting-only booking recipient rules (Issue #78 UI). Tutoring allows Myself or any owned member. */

export function isBabysittingBookingCategory(categorySlug: string | null | undefined) {
  return categorySlug === "babysitting";
}

/** @deprecated use isBabysittingBookingCategory — babysitting only, not tutoring */
export function isChildOnlyBookingCategory(categorySlug: string | null | undefined) {
  return isBabysittingBookingCategory(categorySlug);
}

export function shouldShowMyselfBookingOption(categorySlug: string | null | undefined) {
  return !isBabysittingBookingCategory(categorySlug);
}

export function resolveBookingFamilyMemberId(args: {
  categorySlug: string | null | undefined;
  forWhom: string;
}): string | null {
  if (args.forWhom === "myself") return null;
  return args.forWhom;
}

export function isForWhomStepComplete(args: {
  categorySlug: string | null | undefined;
  forWhom: string;
  familyMemberIds: string[];
}) {
  if (isBabysittingBookingCategory(args.categorySlug)) {
    return args.familyMemberIds.includes(args.forWhom);
  }
  return args.forWhom === "myself" || args.familyMemberIds.includes(args.forWhom);
}
