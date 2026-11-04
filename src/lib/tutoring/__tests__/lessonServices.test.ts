import { describe, expect, it } from "vitest";
import {
  isLessonServiceSlug,
  isTeachingCurriculumNa,
  serviceRequiresTeachingCurriculum,
  teachingCapabilityTitleParts,
} from "@/lib/tutoring/lessonServices";
import { isTutoringServiceSlug } from "@/lib/tutoring/teachingCapabilities";

describe("lessonServices", () => {
  it("recognizes lesson slugs without changing school tutoring slugs", () => {
    expect(isLessonServiceSlug("quran-lessons")).toBe(true);
    expect(isLessonServiceSlug("music-lessons")).toBe(true);
    expect(isLessonServiceSlug("school-subject-tutoring")).toBe(false);
    expect(isTutoringServiceSlug("quran-lessons")).toBe(true);
    expect(isTutoringServiceSlug("homework-support")).toBe(true);
  });

  it("omits NA curriculum from customer-facing capability titles", () => {
    expect(
      teachingCapabilityTitleParts({
        subject: "حفظ",
        curriculum: "بدون منهج",
        level: "مبتدئ",
        curriculumCode: "na",
      }),
    ).toEqual(["حفظ", "مبتدئ"]);
    expect(
      teachingCapabilityTitleParts({
        subject: "Math",
        curriculum: "Egyptian",
        level: "G10",
        curriculumCode: "eg_national_ar",
      }),
    ).toEqual(["Math", "Egyptian", "G10"]);
  });

  it("flags curriculum requirement per service slug", () => {
    expect(serviceRequiresTeachingCurriculum("music-lessons")).toBe(false);
    expect(serviceRequiresTeachingCurriculum("language-tutoring")).toBe(true);
    expect(isTeachingCurriculumNa("na")).toBe(true);
  });
});
