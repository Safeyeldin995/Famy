export const LESSON_SERVICE_SLUGS = ["quran-lessons", "music-lessons"] as const;

export const TEACHING_CURRICULUM_NA_CODE = "na";

export type LessonServiceSlug = (typeof LESSON_SERVICE_SLUGS)[number];

export function isLessonServiceSlug(slug: string | null | undefined): slug is LessonServiceSlug {
  return slug === "quran-lessons" || slug === "music-lessons";
}

export function serviceRequiresTeachingCurriculum(slug: string | null | undefined): boolean {
  if (!slug) return true;
  return !isLessonServiceSlug(slug);
}

export function isTeachingCurriculumNa(code: string | null | undefined): boolean {
  return code === TEACHING_CURRICULUM_NA_CODE;
}

export function teachingCapabilityTitleParts(input: {
  subject: string;
  curriculum: string;
  level: string;
  curriculumCode?: string | null;
}): string[] {
  if (isTeachingCurriculumNa(input.curriculumCode)) {
    return [input.subject, input.level];
  }
  return [input.subject, input.curriculum, input.level];
}
