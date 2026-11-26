/**
 * Grade labels shown to parents, per education system.
 *
 * The database keeps one shared grade scale (`kg`, `g1`…`g12`, `skill_*`) so matching
 * stays exact; this helper only changes how a grade reads. It mirrors the SQL
 * function `public.teaching_level_label(...)` (migration 20261126160000).
 */

export type TeachingLevelLabelStyle =
  | "eg"
  | "british_year"
  | "american_grade"
  | "ib_programme"
  | "plain";

export const TEACHING_LEVEL_LABEL_STYLES: readonly TeachingLevelLabelStyle[] = [
  "eg",
  "british_year",
  "american_grade",
  "ib_programme",
  "plain",
];

export function isTeachingLevelLabelStyle(value: unknown): value is TeachingLevelLabelStyle {
  return typeof value === "string" && (TEACHING_LEVEL_LABEL_STYLES as readonly string[]).includes(value);
}

/** School grade number for `g1`…`g12`, 0 for `kg`, null for anything else (skill levels). */
export function schoolGradeNumber(levelCode: string | null | undefined): number | null {
  if (levelCode === "kg") return 0;
  const match = /^g(\d{1,2})$/.exec(levelCode ?? "");
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 12 ? n : null;
}

/** Next grade after the 1 September advance, or null when the grade does not move (g12, skills). */
export function nextSchoolGradeCode(levelCode: string | null | undefined): string | null {
  const n = schoolGradeNumber(levelCode);
  if (n === null || n >= 12) return null;
  return `g${n + 1}`;
}

/**
 * Human label for a grade in a given system.
 * Falls back to `fallbackName` (the level's own name) for skill levels and unknown codes.
 */
export function teachingLevelLabel(input: {
  levelCode: string | null | undefined;
  style: TeachingLevelLabelStyle | string | null | undefined;
  lang: "ar" | "en";
  fallbackName?: string | null;
}): string {
  const { levelCode, lang } = input;
  const style = isTeachingLevelLabelStyle(input.style) ? input.style : "plain";
  const fallback = input.fallbackName ?? levelCode ?? "";
  const n = schoolGradeNumber(levelCode);
  if (n === null) return fallback;

  switch (style) {
    case "eg": {
      if (n === 0) return lang === "ar" ? "KG" : "KG";
      if (n <= 6) return lang === "ar" ? `${n} ابتدائي` : `Primary ${n}`;
      if (n <= 9) return lang === "ar" ? `${n - 6} إعدادي` : `Prep ${n - 6}`;
      return lang === "ar" ? `${n - 9} ثانوي` : `Secondary ${n - 9}`;
    }
    case "british_year":
      // Year 1 = KG, Year 2 = grade 1 (the usual mapping in Egyptian British schools).
      return `Year ${n + 1}`;
    case "american_grade":
      return n === 0 ? "KG" : `Grade ${n}`;
    case "ib_programme": {
      const grade = n === 0 ? "KG" : `Grade ${n}`;
      if (n <= 5) return `PYP · ${grade}`;
      if (n <= 10) return `MYP · ${grade}`;
      return `DP · ${grade}`;
    }
    default:
      return fallback;
  }
}
