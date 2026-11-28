/**
 * «بيدرس إيه» on the tutor profile: approved capabilities grouped by subject and system,
 * with grades collapsed into ranges and labelled the way the student picker labels them
 * («كي جي», «3 ابتدائي», «Year 2») — #573. Pure; shared by web and mobile.
 */
import { levelRanges } from "../tutoring/levelRanges";
import { teachingLevelLabel } from "../tutoring/teachingLevelLabels";

export type TeachingCapLike = {
  subjectCode: string;
  subjectNameAr: string;
  subjectNameEn: string;
  curriculumCode: string;
  curriculumNameAr: string;
  curriculumNameEn: string;
  levelCode: string;
  levelNameAr: string;
  levelNameEn: string;
  durationMin: number;
  price: number;
};

export type TeachingGroup = {
  key: string;
  subject: string;
  /** null for subjects with no school system (Quran, music). */
  curriculum: string | null;
  ranges: { from: string; to?: string }[];
  minPrice: number | null;
  maxPrice: number | null;
  durations: number[];
};

const NO_CURRICULUM = "na";

export function groupTeaching(
  caps: TeachingCapLike[],
  styleByCurriculum: ReadonlyMap<string, string | null | undefined>,
  lang: "ar" | "en",
): TeachingGroup[] {
  const ar = lang === "ar";
  const groups = new Map<string, TeachingCapLike[]>();
  for (const cap of caps) {
    const key = `${cap.subjectCode}|${cap.curriculumCode}`;
    groups.set(key, [...(groups.get(key) ?? []), cap]);
  }
  return [...groups].map(([key, rows]) => {
    const c = rows[0];
    const style = styleByCurriculum.get(c.curriculumCode) ?? "plain";
    const prices = rows.map((r) => Number(r.price)).filter((p) => Number.isFinite(p) && p > 0);
    return {
      key,
      subject: (ar ? c.subjectNameAr : c.subjectNameEn) || c.subjectNameAr,
      curriculum:
        c.curriculumCode && c.curriculumCode !== NO_CURRICULUM
          ? (ar ? c.curriculumNameAr : c.curriculumNameEn) || c.curriculumNameAr
          : null,
      ranges: levelRanges(
        rows.map((r) => ({
          code: r.levelCode,
          name: teachingLevelLabel({
            levelCode: r.levelCode,
            style,
            lang,
            fallbackName:
              r.levelCode === "kg"
                ? ar
                  ? "كي جي"
                  : "KG"
                : (ar ? r.levelNameAr : r.levelNameEn) || r.levelNameAr,
          }),
        })),
      ),
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      durations: [...new Set(rows.map((r) => r.durationMin).filter((d) => d > 0))].sort(
        (a, b) => a - b,
      ),
    };
  });
}

/** «200 ج.م للحصة، 60 دقيقة» when there is one price and one length, else «من 200 ج.م للحصة». */
export function teachingGroupPrice(
  g: Pick<TeachingGroup, "minPrice" | "maxPrice" | "durations">,
  t: (key: string, options?: Record<string, unknown>) => string,
  money: (value: number) => string,
): string | null {
  if (g.minPrice === null) return null;
  if (g.minPrice === g.maxPrice && g.durations.length === 1) {
    return t("providerPage.session", { price: money(g.minPrice), minutes: String(g.durations[0]) });
  }
  return t("providerTrust.fromSession", { price: money(g.minPrice) });
}
