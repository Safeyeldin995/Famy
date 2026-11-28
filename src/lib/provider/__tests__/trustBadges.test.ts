import { describe, expect, it } from "vitest";
import {
  bioSnippet,
  cardCompletedCount,
  normalizeTrustStats,
  reviewLessonParts,
  trustBadges,
  type PublicReviewRow,
} from "../trustBadges";
import { groupTeaching, teachingGroupPrice, type TeachingCapLike } from "../teachingGroups";

const stats = (over: Record<string, unknown> = {}) =>
  normalizeTrustStats({
    provider_id: "p1",
    is_verified: true,
    completed_bookings: 14,
    completed_lessons: 12,
    never_cancels: true,
    offers_online: true,
    offers_in_person: false,
    ...over,
  });

describe("trust badges", () => {
  it("shows only facts that exist, in order", () => {
    expect(trustBadges(stats(), { tutoring: true })).toEqual([
      { key: "verified" },
      { key: "lessons", count: 12 },
      { key: "neverCancels" },
    ]);
    expect(trustBadges(stats(), { tutoring: false })).toEqual([
      { key: "verified" },
      { key: "bookings", count: 14 },
      { key: "neverCancels" },
    ]);
  });

  it("hides the cancellation badge without enough history or after a cancellation", () => {
    expect(trustBadges(stats({ never_cancels: null }), { tutoring: true })).not.toContainEqual({
      key: "neverCancels",
    });
    expect(trustBadges(stats({ never_cancels: false }), { tutoring: true })).not.toContainEqual({
      key: "neverCancels",
    });
  });

  it("never shows a zero count and never invents one", () => {
    const fresh = stats({
      is_verified: false,
      completed_bookings: 0,
      completed_lessons: 0,
      never_cancels: null,
    });
    expect(trustBadges(fresh, { tutoring: true })).toEqual([]);
    expect(cardCompletedCount(fresh, true)).toBeNull();
    expect(cardCompletedCount(null, true)).toBeNull();
    expect(
      normalizeTrustStats({ provider_id: "x", completed_lessons: -3 })?.completed_lessons,
    ).toBe(0);
    expect(normalizeTrustStats(null)).toBeNull();
  });

  it("uses the provider row's verified flag while stats load", () => {
    expect(trustBadges(null, { tutoring: true, verifiedFallback: true })).toEqual([
      { key: "verified" },
    ]);
    expect(trustBadges(null, { tutoring: true })).toEqual([]);
  });

  it("flattens the bio for a two-line card", () => {
    expect(bioSnippet("  مدرسة\n\n\nفرنساوي   ")).toBe("مدرسة فرنساوي");
    expect(bioSnippet(null)).toBe("");
  });
});

const review = (over: Partial<PublicReviewRow> = {}): PublicReviewRow => ({
  id: "r1",
  rating: 5,
  comment: null,
  provider_reply: null,
  created_at: "2026-11-01T10:00:00Z",
  subject_name_ar: "اللغة الفرنسية",
  subject_name_en: "French",
  curriculum_code: "eg_national_lang",
  curriculum_name_ar: "تجريبي / لغات",
  curriculum_name_en: "Experimental / Language",
  level_code: "g3",
  level_label_style: "eg",
  level_name_ar: "الصف الثالث",
  level_name_en: "Grade 3",
  total_count: 1,
  ...over,
});

describe("review lesson line", () => {
  it("labels the grade the way the picker does", () => {
    expect(reviewLessonParts(review(), "ar")).toEqual([
      "اللغة الفرنسية",
      "3 ابتدائي",
      "تجريبي / لغات",
    ]);
    expect(reviewLessonParts(review({ level_code: "kg" }), "ar")[1]).toBe("كي جي");
    expect(
      reviewLessonParts(review({ level_label_style: "british_year", level_code: "g1" }), "en")[1],
    ).toBe("Year 2");
  });

  it("skips the system for Quran and music, and shows nothing for non-lesson bookings", () => {
    expect(
      reviewLessonParts(
        review({
          curriculum_code: "na",
          level_code: "skill_beginner",
          level_label_style: "plain",
          level_name_ar: "مبتدئ",
          subject_name_ar: "حفظ القرآن",
        }),
        "ar",
      ),
    ).toEqual(["حفظ القرآن", "مبتدئ"]);
    expect(
      reviewLessonParts(
        review({
          subject_name_ar: null,
          subject_name_en: null,
          curriculum_code: null,
          level_code: null,
          level_name_ar: null,
          level_name_en: null,
        }),
        "ar",
      ),
    ).toEqual([]);
  });
});

const cap = (over: Partial<TeachingCapLike>): TeachingCapLike => ({
  subjectCode: "math",
  subjectNameAr: "الرياضيات",
  subjectNameEn: "Mathematics",
  curriculumCode: "american",
  curriculumNameAr: "أمريكي",
  curriculumNameEn: "American",
  levelCode: "g1",
  levelNameAr: "الصف الأول",
  levelNameEn: "Grade 1",
  durationMin: 60,
  price: 300,
  ...over,
});

describe("what they teach (#573)", () => {
  const styles = new Map([
    ["american", "american_grade"],
    ["eg_national_ar", "eg"],
  ]);
  const t = (key: string, o?: Record<string, unknown>) => `${key}:${JSON.stringify(o)}`;

  it("groups by subject and system, with picker-style grade ranges", () => {
    const groups = groupTeaching(
      [
        cap({ levelCode: "kg", levelNameAr: "رياض الأطفال (KG1–KG2)" }),
        cap({ levelCode: "g1" }),
        cap({ levelCode: "g2", price: 350 }),
        cap({ curriculumCode: "eg_national_ar", curriculumNameAr: "عربي حكومي", levelCode: "g7" }),
      ],
      styles,
      "ar",
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      subject: "الرياضيات",
      curriculum: "أمريكي",
      ranges: [{ from: "KG", to: "Grade 2" }],
      minPrice: 300,
      maxPrice: 350,
    });
    expect(groups[1].ranges).toEqual([{ from: "1 إعدادي" }]);
    expect(teachingGroupPrice(groups[0], t, String)).toBe(
      'providerTrust.fromSession:{"price":"300"}',
    );
    expect(teachingGroupPrice(groups[1], t, String)).toBe(
      'providerPage.session:{"price":"300","minutes":"60"}',
    );
  });

  it("never shows the raw KG catalog name, and hides «na» as a system", () => {
    const [g] = groupTeaching(
      [cap({ curriculumCode: "french", levelCode: "kg", levelNameAr: "رياض الأطفال (KG1–KG2)" })],
      new Map(),
      "ar",
    );
    expect(g.ranges).toEqual([{ from: "كي جي" }]);
    const [q] = groupTeaching(
      [
        cap({
          subjectNameAr: "حفظ القرآن",
          curriculumCode: "na",
          levelCode: "skill_beginner",
          levelNameAr: "مبتدئ",
        }),
      ],
      new Map(),
      "ar",
    );
    expect(q.curriculum).toBeNull();
    expect(q.ranges).toEqual([{ from: "مبتدئ" }]);
  });
});
