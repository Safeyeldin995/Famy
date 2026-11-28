/**
 * Trust facts on the provider card and profile (PO decision, 28 Nov).
 *
 * Pure and framework-free, shared by web and the mobile app (`@shared/provider/trustBadges`).
 * Every badge comes from `public_provider_trust_stats` (real records only). A badge whose
 * data is missing is hidden; nothing here ever invents a number.
 */
import { teachingLevelLabel } from "../tutoring/teachingLevelLabels";

export type ProviderTrustStats = {
  provider_id: string;
  is_verified: boolean;
  completed_bookings: number;
  completed_lessons: number;
  /** NULL until the provider has enough completed bookings to say it. */
  never_cancels: boolean | null;
  offers_online: boolean;
  offers_in_person: boolean;
};

export type TrustBadge =
  | { key: "verified" }
  | { key: "lessons"; count: number }
  | { key: "bookings"; count: number }
  | { key: "neverCancels" };

/** i18n key for each badge under `providerTrust.*`. */
export const TRUST_BADGE_I18N: Record<TrustBadge["key"], string> = {
  verified: "providerTrust.verified",
  lessons: "providerTrust.lessons",
  bookings: "providerTrust.bookings",
  neverCancels: "providerTrust.neverCancels",
};

/** The badge's text, e.g. «12 حصة على فامي». */
export function trustBadgeText(
  t: (key: string, options?: Record<string, unknown>) => string,
  badge: TrustBadge,
): string {
  return "count" in badge
    ? t(TRUST_BADGE_I18N[badge.key], { count: badge.count })
    : t(TRUST_BADGE_I18N[badge.key]);
}

export function normalizeTrustStats(
  row: Record<string, unknown> | null | undefined,
): ProviderTrustStats | null {
  if (!row || typeof row.provider_id !== "string") return null;
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
  };
  return {
    provider_id: row.provider_id,
    is_verified: row.is_verified === true,
    completed_bookings: n(row.completed_bookings),
    completed_lessons: n(row.completed_lessons),
    never_cancels: typeof row.never_cancels === "boolean" ? row.never_cancels : null,
    offers_online: row.offers_online === true,
    offers_in_person: row.offers_in_person === true,
  };
}

/**
 * Badges in display order. `tutoring` counts lessons (حصة) instead of bookings.
 * `verified` may also come from the provider row when stats are still loading.
 */
export function trustBadges(
  stats: ProviderTrustStats | null | undefined,
  opts: { tutoring: boolean; verifiedFallback?: boolean },
): TrustBadge[] {
  const out: TrustBadge[] = [];
  if (stats?.is_verified ?? opts.verifiedFallback) out.push({ key: "verified" });
  if (stats) {
    if (opts.tutoring && stats.completed_lessons > 0) {
      out.push({ key: "lessons", count: stats.completed_lessons });
    } else if (!opts.tutoring && stats.completed_bookings > 0) {
      out.push({ key: "bookings", count: stats.completed_bookings });
    }
    if (stats.never_cancels === true) out.push({ key: "neverCancels" });
  }
  return out;
}

/** The card's count line, or null when there is nothing real to show. */
export function cardCompletedCount(
  stats: ProviderTrustStats | null | undefined,
  tutoring: boolean,
): TrustBadge | null {
  if (!stats) return null;
  if (tutoring)
    return stats.completed_lessons > 0 ? { key: "lessons", count: stats.completed_lessons } : null;
  return stats.completed_bookings > 0 ? { key: "bookings", count: stats.completed_bookings } : null;
}

export type PublicReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  provider_reply: string | null;
  created_at: string;
  subject_name_ar: string | null;
  subject_name_en: string | null;
  curriculum_code: string | null;
  curriculum_name_ar: string | null;
  curriculum_name_en: string | null;
  level_code: string | null;
  level_label_style: string | null;
  level_name_ar: string | null;
  level_name_en: string | null;
  total_count: number;
};

/**
 * «فرنساوي · 3 ابتدائي · عربي حكومي» for a review of a lesson; null for bookings with no
 * teaching snapshot (babysitting, older lessons). The `na` curriculum (Quran, music) is skipped.
 */
export function reviewLessonParts(r: PublicReviewRow, lang: "ar" | "en"): string[] {
  const ar = lang === "ar";
  const subject = (ar ? r.subject_name_ar : r.subject_name_en) || r.subject_name_ar || "";
  const levelFallback = (ar ? r.level_name_ar : r.level_name_en) || r.level_name_ar;
  const level =
    r.level_code || levelFallback
      ? teachingLevelLabel({
          levelCode: r.level_code,
          style: r.level_label_style,
          lang,
          fallbackName: levelFallback,
        })
      : "";
  const curriculum =
    r.curriculum_code && r.curriculum_code !== "na"
      ? (ar ? r.curriculum_name_ar : r.curriculum_name_en) || r.curriculum_name_ar || ""
      : "";
  return [subject, level, curriculum].map((s) => s.trim()).filter(Boolean);
}

/** Card bio: whitespace collapsed so a bio pasted with blank lines stays two lines; the UI clamps it. */
export function bioSnippet(bio: string | null | undefined): string {
  return (bio ?? "").replace(/\s+/g, " ").trim();
}
