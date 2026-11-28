/**
 * Application step 2 groups services by what the provider offers (PO, 28 Nov):
 * «دروس» / «قرآن» / «موسيقى» / «جليسة أطفال». A provider may pick from several doors
 * (e.g. Arabic lessons and Quran). Quran and music are recognised by their own category
 * (once split from tutoring) or, before that, by the service slug.
 */
export type ServiceDoor = "lessons" | "quran" | "music" | "babysitting";

export const SERVICE_DOOR_ORDER: readonly ServiceDoor[] = [
  "lessons",
  "quran",
  "music",
  "babysitting",
];

type DoorService = { slug?: string | null; category?: { slug?: string | null } | null };

export function serviceDoor(service: DoorService): ServiceDoor {
  const category = service.category?.slug ?? "";
  const slug = service.slug ?? "";
  if (category === "babysitting") return "babysitting";
  if (category === "quran" || slug.startsWith("quran")) return "quran";
  if (category === "music" || slug.startsWith("music")) return "music";
  return "lessons";
}

export function groupServicesByDoor<T extends DoorService>(services: T[]) {
  return SERVICE_DOOR_ORDER.map((door) => ({
    door,
    services: services.filter((s) => serviceDoor(s) === door),
  })).filter((group) => group.services.length > 0);
}

/**
 * Where a returning applicant continues: the first step whose saved answers are missing.
 * Uses the same readiness rules as the steps themselves, so nothing new is required.
 */
export function resumeApplyStep(saved: {
  basicsReady: boolean;
  servicesReady: boolean;
}): 1 | 2 | 3 {
  if (!saved.basicsReady) return 1;
  if (!saved.servicesReady) return 2;
  return 3;
}
