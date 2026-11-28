import { isLessonServiceSlug, type LessonServiceSlug } from "../tutoring/lessonServices";

/**
 * Customer-facing service groups. Quran and music live in the DB "tutoring"
 * category (same booking/teaching rules) but are shown as their own groups,
 * separate from school tutoring.
 */
export type HomeCategoryId = "babysitting" | "tutoring" | "quran" | "music";

export const HOME_CATEGORY_IDS: readonly HomeCategoryId[] = [
  "babysitting",
  "tutoring",
  "quran",
  "music",
];

const LESSON_GROUPS: Record<"quran" | "music", LessonServiceSlug> = {
  quran: "quran-lessons",
  music: "music-lessons",
};

export function isHomeCategoryId(value: string | null | undefined): value is HomeCategoryId {
  return HOME_CATEGORY_IDS.includes(value as HomeCategoryId);
}

/** DB category slug the group's services belong to. */
export function homeCategoryDbSlug(id: HomeCategoryId): "babysitting" | "tutoring" {
  return id === "babysitting" ? "babysitting" : "tutoring";
}

/** Lesson service slug for Quran/music groups, else null. */
export function homeCategoryLessonSlug(id: HomeCategoryId): LessonServiceSlug | null {
  return id === "quran" || id === "music" ? LESSON_GROUPS[id] : null;
}

/** Services shown inside a group: lesson groups get only their service; tutoring excludes lessons. */
export function servicesForHomeCategory<T extends { slug?: string | null }>(
  services: T[],
  id: HomeCategoryId,
): T[] {
  const lesson = homeCategoryLessonSlug(id);
  if (lesson) return services.filter((s) => s.slug === lesson);
  if (id === "tutoring") return services.filter((s) => !isLessonServiceSlug(s.slug));
  return services;
}

/**
 * The customer home shows two separate doors (PO, 28 Nov 2026): tutoring and
 * babysitting are different services and never share a list on the home.
 * Quran and music sit inside the tutoring door as shortcuts.
 */
export type HomeDoorId = "tutoring" | "babysitting";

export const HOME_DOOR_IDS: readonly HomeDoorId[] = ["tutoring", "babysitting"];

export const TUTORING_DOOR_SHORTCUTS: readonly ("quran" | "music")[] = ["quran", "music"];

/** A door shows only when its DB category is live. */
export function visibleHomeDoors(categorySlugs: readonly string[]): HomeDoorId[] {
  return HOME_DOOR_IDS.filter((id) => categorySlugs.includes(id));
}

/** Quran/music shortcuts show only when their lesson service is live. */
export function visibleTutoringShortcuts(
  serviceSlugs: readonly (string | null | undefined)[],
): ("quran" | "music")[] {
  return TUTORING_DOOR_SHORTCUTS.filter((id) => {
    const lesson = homeCategoryLessonSlug(id);
    return lesson ? serviceSlugs.includes(lesson) : false;
  });
}
