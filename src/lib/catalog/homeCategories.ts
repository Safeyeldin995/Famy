import { isLessonServiceSlug, type LessonServiceSlug } from "../tutoring/lessonServices";

/**
 * Customer-facing service groups. Since 28 Nov 2026 each group is its own DB
 * category: «دروس» (tutoring: school subjects, languages, homework help),
 * «قرآن» (quran), «موسيقى» (music) and «جليسة أطفال» (babysitting).
 * Quran and music keep the teaching rules (subjects, levels, online).
 */
export type HomeCategoryId = "babysitting" | "tutoring" | "quran" | "music";

export const HOME_CATEGORY_IDS: readonly HomeCategoryId[] = [
  "tutoring",
  "quran",
  "music",
  "babysitting",
];

const LESSON_GROUPS: Record<"quran" | "music", LessonServiceSlug> = {
  quran: "quran-lessons",
  music: "music-lessons",
};

export function isHomeCategoryId(value: string | null | undefined): value is HomeCategoryId {
  return HOME_CATEGORY_IDS.includes(value as HomeCategoryId);
}

/** DB category slug the group's services belong to (each group is its own category). */
export function homeCategoryDbSlug(id: HomeCategoryId): HomeCategoryId {
  return id;
}

/** Lesson service slug for Quran/music groups, else null. */
export function homeCategoryLessonSlug(id: HomeCategoryId): LessonServiceSlug | null {
  return id === "quran" || id === "music" ? LESSON_GROUPS[id] : null;
}

/** DB category of a lesson service (quran-lessons → quran, music-lessons → music). */
export function lessonServiceCategorySlug(slug: string | null | undefined): "quran" | "music" | null {
  if (slug === "quran-lessons") return "quran";
  if (slug === "music-lessons") return "music";
  return null;
}

/**
 * Services shown inside a group. Each group is its own category, so this only
 * guards against a stale cache: lesson groups keep their own service and
 * tutoring never shows a Quran or music service.
 */
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
 * The customer home shows four separate doors (PO, 28 Nov 2026): school
 * tutoring, Quran, music and babysitting never share a list on the home.
 */
export type HomeDoorId = HomeCategoryId;

export const HOME_DOOR_IDS: readonly HomeDoorId[] = HOME_CATEGORY_IDS;

/** A door shows only when its DB category is live. */
export function visibleHomeDoors(categorySlugs: readonly string[]): HomeDoorId[] {
  return HOME_DOOR_IDS.filter((id) => categorySlugs.includes(id));
}
