import { teachingCapabilityTitleParts } from "./lessonServices";

type BookingTeaching = {
  teaching_subject_code?: string | null;
  teaching_subject_name_ar?: string | null;
  teaching_subject_name_en?: string | null;
  teaching_curriculum_code?: string | null;
  teaching_curriculum_name_ar?: string | null;
  teaching_curriculum_name_en?: string | null;
  teaching_level_name_ar?: string | null;
  teaching_level_name_en?: string | null;
};

/** "Subject · Curriculum · Level" for a tutoring booking; lessons (no curriculum) omit it. */
export function bookingTeachingSummary(b: BookingTeaching, lang: string): string | null {
  if (!b.teaching_subject_code) return null;
  const ar = lang.startsWith("ar");
  const pick = (a?: string | null, e?: string | null) => (ar ? (a ?? e) : (e ?? a)) ?? "";
  return teachingCapabilityTitleParts({
    subject: pick(b.teaching_subject_name_ar, b.teaching_subject_name_en),
    curriculum: pick(b.teaching_curriculum_name_ar, b.teaching_curriculum_name_en),
    level: pick(b.teaching_level_name_ar, b.teaching_level_name_en),
    curriculumCode: b.teaching_curriculum_code,
  })
    .filter(Boolean)
    .join(" · ");
}
