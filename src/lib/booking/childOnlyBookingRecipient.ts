import { isClosedBetaCategorySlug } from "@/lib/catalog/closedBetaCategories";

/** Babysitting and tutoring require one saved customer-owned child (no Myself). */
export function isChildOnlyBookingCategory(categorySlug: string | null | undefined) {
  return isClosedBetaCategorySlug(categorySlug);
}

export function shouldShowMyselfBookingOption(categorySlug: string | null | undefined) {
  return !isChildOnlyBookingCategory(categorySlug);
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
  if (isChildOnlyBookingCategory(args.categorySlug)) {
    return args.familyMemberIds.includes(args.forWhom);
  }
  return args.forWhom === "myself" || args.familyMemberIds.includes(args.forWhom);
}
