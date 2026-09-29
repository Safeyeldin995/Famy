/** Category-slug helpers for booking recipient UI (Issue #78). Delegates to babysittingRecipient. */

import type { BookingFamilyMember } from "@/lib/booking/babysittingRecipient";
import {
  bookingFamilyMemberId,
  canContinueForWhom,
  isBabysittingCategorySlug,
  showMyselfOption,
} from "@/lib/booking/babysittingRecipient";

export function isBabysittingBookingCategory(categorySlug: string | null | undefined) {
  return isBabysittingCategorySlug(categorySlug);
}

/** @deprecated use isBabysittingBookingCategory — babysitting only, not tutoring */
export function isChildOnlyBookingCategory(categorySlug: string | null | undefined) {
  return isBabysittingBookingCategory(categorySlug);
}

export function shouldShowMyselfBookingOption(categorySlug: string | null | undefined) {
  return showMyselfOption(isBabysittingCategorySlug(categorySlug));
}

export function resolveBookingFamilyMemberId(args: {
  categorySlug: string | null | undefined;
  forWhom: string;
}): string | null {
  return bookingFamilyMemberId(args.forWhom);
}

export function isForWhomStepComplete(args: {
  categorySlug: string | null | undefined;
  forWhom: string;
  familyMemberIds: string[];
  members?: BookingFamilyMember[];
  startAt?: string | Date | null;
}) {
  const members =
    args.members ??
    args.familyMemberIds.map((id) => ({
      id,
    }));
  return canContinueForWhom({
    isBabysitting: isBabysittingCategorySlug(args.categorySlug),
    forWhom: args.forWhom,
    members,
    startAt: args.startAt ?? null,
  });
}
