import type { TeachingCapabilityOption } from "@/lib/tutoring/teachingCapabilities";
import type { EducationProfileIds } from "@/lib/tutoring/studentEducationProfile";

export function capabilitiesMatchingEducation(
  capabilities: TeachingCapabilityOption[],
  serviceId: string | null | undefined,
  curriculumId: string | null,
  levelId: string | null,
): TeachingCapabilityOption[] {
  if (!curriculumId || !levelId) return capabilities;
  return capabilities.filter(
    (cap) =>
      (!serviceId || cap.serviceId === serviceId) &&
      cap.curriculumCode &&
      cap.levelCode &&
      matchesTaxonomyIds(cap, curriculumId, levelId),
  );
}

function matchesTaxonomyIds(
  cap: TeachingCapabilityOption,
  curriculumId: string,
  levelId: string,
): boolean {
  return cap.curriculumId === curriculumId && cap.levelId === levelId;
}

export function pickDefaultCapabilityForEducation(
  capabilities: TeachingCapabilityOption[],
  serviceId: string | null | undefined,
  curriculumId: string | null,
  levelId: string | null,
): TeachingCapabilityOption | null {
  const matches = capabilitiesMatchingEducation(
    capabilities,
    serviceId,
    curriculumId,
    levelId,
  );
  return matches[0] ?? null;
}

export type BookingEducationDraft = EducationProfileIds;

export function shouldPersistBookingEducation(args: {
  saveForNextTime: boolean;
  draft: BookingEducationDraft;
  saved: EducationProfileIds;
}): boolean {
  if (!args.saveForNextTime) return false;
  return (
    args.draft.educationCurriculumId !== args.saved.educationCurriculumId ||
    args.draft.educationLevelId !== args.saved.educationLevelId
  );
}

/** Only after create_booking succeeds (including idempotent replay). */
export function shouldPersistEducationAfterBookingSuccess(args: {
  bookingSucceeded: boolean;
  isTutoring: boolean;
  saveForNextTime: boolean;
  draft: BookingEducationDraft;
  saved: EducationProfileIds;
}): boolean {
  if (!args.bookingSucceeded || !args.isTutoring) return false;
  return shouldPersistBookingEducation({
    saveForNextTime: args.saveForNextTime,
    draft: args.draft,
    saved: args.saved,
  });
}

export async function persistEducationProfileAfterBooking(args: {
  save: () => Promise<unknown>;
}): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await args.save();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export function educationDraftFromCapability(
  capability: TeachingCapabilityOption | null,
): BookingEducationDraft {
  if (!capability) {
    return { educationCurriculumId: null, educationLevelId: null };
  }
  return {
    educationCurriculumId: capability.curriculumId ?? null,
    educationLevelId: capability.levelId ?? null,
  };
}
