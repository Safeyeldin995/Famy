import { isLessonServiceSlug, type LessonServiceSlug } from "./lessonServices";

/** Stable keys shared by web SVG components and mobile react-native-svg. */
export type LessonIllustrationKey =
  | "quran_lessons_tile"
  | "quran_memorization"
  | "quran_tajweed"
  | "quran_recitation_review"
  | "music_lessons_tile"
  | "music_piano_keyboard"
  | "music_guitar"
  | "music_oud"
  | "music_violin";

export const LESSON_BRAND = "#F10E72";
export const LESSON_BRAND_TINT = "#FDEAF2";
export const LESSON_BRAND_TINT_STRONG = "#FBC6DD";

const SUBJECT_ILLUSTRATIONS: Record<string, LessonIllustrationKey> = {
  quran_memorization: "quran_memorization",
  quran_tajweed: "quran_tajweed",
  quran_recitation_review: "quran_recitation_review",
  music_piano_keyboard: "music_piano_keyboard",
  music_guitar: "music_guitar",
  music_oud: "music_oud",
  music_violin: "music_violin",
};

const SERVICE_TILE_ILLUSTRATIONS: Record<LessonServiceSlug, LessonIllustrationKey> = {
  "quran-lessons": "quran_lessons_tile",
  "music-lessons": "music_lessons_tile",
};

export function lessonIllustrationKeyForSubject(
  subjectCode: string | null | undefined,
): LessonIllustrationKey | null {
  if (!subjectCode) return null;
  return SUBJECT_ILLUSTRATIONS[subjectCode] ?? null;
}

export function lessonIllustrationKeyForService(
  serviceSlug: string | null | undefined,
): LessonIllustrationKey | null {
  if (!isLessonServiceSlug(serviceSlug)) return null;
  return SERVICE_TILE_ILLUSTRATIONS[serviceSlug];
}

export function isLessonSubjectCode(subjectCode: string | null | undefined): boolean {
  return lessonIllustrationKeyForSubject(subjectCode) != null;
}
