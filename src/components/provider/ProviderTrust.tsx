import { useTranslation } from "react-i18next";
import { BadgeCheck, CalendarCheck2, Home, MonitorPlay, ShieldCheck, Star } from "lucide-react";
import { QueryError } from "@/components/famio/QueryError";
import { formatDate, formatLocale, formatNumber } from "@/lib/format";
import { currentLang } from "@/lib/i18n";
import { usePublicProviderReviews, useProviderTrustStats } from "@/lib/db/trust-queries";
import {
  trustBadgeText,
  reviewLessonParts,
  trustBadges,
  type ProviderTrustStats,
  type TrustBadge,
} from "@/lib/provider/trustBadges";

function badgeIcon(key: TrustBadge["key"]) {
  switch (key) {
    case "verified":
      return BadgeCheck;
    case "neverCancels":
      return ShieldCheck;
    default:
      return CalendarCheck2;
  }
}


/** Trust facts under the profile header. Renders nothing when there is no real fact to show. */
export function ProviderTrustBadges({
  providerId,
  tutoring,
  verifiedFallback,
  showModes = true,
}: {
  providerId: string;
  tutoring: boolean;
  verifiedFallback?: boolean;
  showModes?: boolean;
}) {
  const { t } = useTranslation();
  const statsQ = useProviderTrustStats(providerId);
  const stats: ProviderTrustStats | null = statsQ.data ?? null;
  const badges = trustBadges(stats, { tutoring, verifiedFallback });
  const modes =
    showModes && stats
      ? [
          stats.offers_online ? ({ key: "online", Icon: MonitorPlay } as const) : null,
          stats.offers_in_person ? ({ key: "inPerson", Icon: Home } as const) : null,
        ].filter((m): m is NonNullable<typeof m> => m !== null)
      : [];

  if (statsQ.isLoading) {
    return (
      <div
        className="skeleton h-16 rounded-2xl"
        aria-busy="true"
        aria-label={t("common.loading")}
      />
    );
  }
  if (!badges.length && !modes.length) return null;

  return (
    <section aria-label={t("providerTrust.label")} className="space-y-3">
      {badges.length ? (
        <ul className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          {badges.map((badge) => {
            const Icon = badgeIcon(badge.key);
            return (
              <li
                key={badge.key}
                className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-border/60 bg-white px-3 py-2.5"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success/10 text-success">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 text-pro-13 font-bold leading-snug text-foreground">
                  {trustBadgeText(t, badge)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {modes.length ? (
        <ul className="flex flex-wrap gap-2">
          {modes.map(({ key, Icon }) => (
            <li
              key={key}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-pro-12 font-bold text-brand"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t(key === "online" ? "providerTrust.online" : "providerTrust.inPerson")}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Stars({ rating }: { rating: number }) {
  const { t } = useTranslation();
  return (
    <span
      className="flex items-center gap-0.5"
      role="img"
      aria-label={t("providerTrust.ratingOutOf", { rating: formatNumber(rating) })}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i < rating ? "fill-amber-400 text-amber-400" : "text-border"}`}
          aria-hidden
        />
      ))}
    </span>
  );
}

/**
 * Reviews with the lesson they were for («فرنساوي · 3 ابتدائي · IB»), newest first, five at a
 * time with «كل التقييمات». Reviewer identity is never shown.
 */
export function PublicProviderReviews({
  providerId,
  emptyText,
}: {
  providerId: string;
  emptyText: string;
}) {
  const { t } = useTranslation();
  const lang = currentLang();
  const q = usePublicProviderReviews(providerId);
  const rows = (q.data?.pages ?? []).flat();
  const total = rows[0]?.total_count ?? 0;

  if (q.isLoading)
    return (
      <div
        className="skeleton h-24 rounded-2xl"
        aria-busy="true"
        aria-label={t("common.loading")}
      />
    );
  if (q.isError) return <QueryError compact onRetry={() => void q.refetch()} />;
  if (!rows.length) return <p className="text-pro-14 text-muted-foreground">{emptyText}</p>;

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {rows.map((r) => {
          const lesson = reviewLessonParts(r, lang);
          return (
            <li key={r.id} className="rounded-2xl border border-border/60 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <Stars rating={Number(r.rating)} />
                <span className="shrink-0 text-pro-12 text-muted-foreground">
                  {formatDate(
                    new Date(r.created_at),
                    { day: "numeric", month: "long", year: "numeric" },
                    formatLocale(lang),
                  )}
                </span>
              </div>
              {lesson.length ? (
                <p className="mt-2 text-pro-12 font-bold text-muted-foreground">
                  {lesson.join(" · ")}
                </p>
              ) : null}
              {r.comment ? (
                <p className="mt-2 whitespace-pre-line text-pro-14 leading-relaxed text-foreground">
                  {r.comment}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {q.hasNextPage ? (
        <button
          type="button"
          className="focus-ring h-11 w-full rounded-2xl border border-brand/40 text-pro-14 font-bold text-brand disabled:opacity-60"
          onClick={() => void q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
          aria-busy={q.isFetchingNextPage}
        >
          {rows.length <= 5 ? t("providerTrust.allReviews") : t("providerTrust.moreReviews")}
          {total ? ` (${formatNumber(total)})` : ""}
        </button>
      ) : null}
    </div>
  );
}
