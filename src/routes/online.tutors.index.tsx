import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Search, ShieldCheck, Star } from "lucide-react";
import { EmptyState, PrimaryButton, ProviderCardSkeleton } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { useOnlineStudentMatch } from "@/components/online/OnlineStudentMatch";
import { customerProviders } from "@/components/famio/customerProviders";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { useOnlineTutors } from "@/lib/db/queries";
import {
  useApprovedTeachingCapabilitiesForProviders,
  useTeachingCurricula,
} from "@/lib/db/teaching-queries";
import { formatEGP, formatNumber } from "@/lib/format";
import { currentLang } from "@/lib/i18n";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { bioSnippet, cardCompletedCount, trustBadgeText } from "@/lib/provider/trustBadges";
import { useProviderTrustStats } from "@/lib/db/trust-queries";
import {
  DIRECTORY_TRACKS,
  NO_CURRICULUM_CODE,
  groupCapabilitiesByProvider,
  sortDirectoryTutors,
  summarizeTutorTeaching,
  tutorMatchesFilter,
  type DirectoryCapability,
  type DirectorySort,
  type DirectoryTrack,
} from "@/lib/online/onlineTutorDirectory";

type TutorsSearch = { curriculum?: string; track?: DirectoryTrack };

export const Route = createFileRoute("/online/tutors/")({
  validateSearch: (search: Record<string, unknown>): TutorsSearch => ({
    curriculum:
      typeof search.curriculum === "string" && search.curriculum ? search.curriculum : undefined,
    track: DIRECTORY_TRACKS.includes(search.track as DirectoryTrack)
      ? (search.track as DirectoryTrack)
      : undefined,
  }),
  component: OnlineTutorsIndex,
});

const SORTS: DirectorySort[] = ["recommended", "rating", "priceLow"];

function OnlineTutorsIndex() {
  const { t, i18n } = useTranslation();
  const lang = currentLang();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/online/tutors/" });
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<DirectorySort>("recommended");
  const tutorsQ = useOnlineTutors(80);
  // «الحجز لمين؟» → subject → only the tutors who teach that learner's system and grade (issue #536).
  const match = useOnlineStudentMatch();
  const curriculaQ = useTeachingCurricula();

  const base = useMemo(
    () => customerProviders(tutorsQ.data ?? []).filter((p) => p.categorySlugs.includes("tutoring")),
    [tutorsQ.data],
  );
  const capsQ = useApprovedTeachingCapabilitiesForProviders(base.map((p) => p.id));
  const capsByProvider = useMemo(
    () => groupCapabilitiesByProvider((capsQ.data ?? []) as DirectoryCapability[]),
    [capsQ.data],
  );

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = base
      .filter((p) => {
        if (!term) return true;
        const caps = capsByProvider.get(p.id) ?? [];
        return (
          p.name.toLowerCase().includes(term) ||
          (p.bio ?? "").toLowerCase().includes(term) ||
          caps.some(
            (c) => c.subjectNameAr.includes(term) || c.subjectNameEn.toLowerCase().includes(term),
          )
        );
      })
      .filter((p) =>
        match.active
          ? match.matched.has(p.id)
          : tutorMatchesFilter(capsByProvider.get(p.id) ?? [], {
              curriculum: search.curriculum,
              track: search.track,
            }),
      )
      .map((p) => {
        const summary = summarizeTutorTeaching(capsByProvider.get(p.id) ?? []);
        const hit = match.active ? match.matched.get(p.id) : undefined;
        return {
          ...p,
          summary: hit ? { ...summary, durations: [hit.session_duration_min] } : summary,
          minPrice: hit ? Number(hit.session_price) : summary.minPrice,
        };
      });
    return sortDirectoryTutors(rows, sort);
  }, [base, capsByProvider, q, search.curriculum, search.track, sort, match.active, match.matched]);

  const filterActive = !match.active && Boolean(search.curriculum || search.track);
  const curricula = (curriculaQ.data ?? []).filter((c) => c.code !== NO_CURRICULUM_CODE);
  const chip = (active: boolean) =>
    `focus-ring shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-pro-13 font-bold transition-colors ${
      active
        ? "border-navy bg-navy text-navy-foreground"
        : "border-border bg-white text-muted-foreground hover:text-foreground"
    }`;
  const setFilter = (next: TutorsSearch) => void navigate({ search: next, replace: true });

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-pro-24 font-extrabold lg:text-pro-28">{t("onlineWeb.tutors.title")}</h1>
        <p className="text-pro-15 text-muted-foreground">{t("onlineWeb.tutors.lead")}</p>
      </header>

      {match.panel}

      <div className="space-y-3 rounded-3xl bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-border/70 bg-white px-4 py-2.5">
            <Search
              className="h-5 w-5 text-muted-foreground"
              strokeWidth={ICON_STROKE_BOLD}
              aria-hidden
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("onlineWeb.tutors.search")}
              className="min-h-10 min-w-0 flex-1 bg-transparent text-pro-15 outline-none"
              aria-label={t("onlineWeb.tutors.search")}
            />
          </label>
          <label className="flex items-center gap-2 text-pro-13 font-bold text-muted-foreground">
            {t("onlineWeb.hub.sortLabel")}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as DirectorySort)}
              className="focus-ring min-h-11 rounded-2xl border border-border/70 bg-white px-3 text-pro-14 font-bold text-foreground"
            >
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(
                    s === "recommended"
                      ? "onlineWeb.hub.sortRecommended"
                      : s === "rating"
                        ? "onlineWeb.hub.sortRating"
                        : "onlineWeb.hub.sortPrice",
                  )}
                </option>
              ))}
            </select>
          </label>
        </div>
        {match.active ? null : (
          <div
            className="online-web-nav-scroll flex gap-2 overflow-x-auto pb-1"
            role="group"
            aria-label={t("onlineWeb.hub.curriculaTitle")}
          >
            <button
              type="button"
              className={chip(!filterActive)}
              aria-pressed={!filterActive}
              onClick={() => setFilter({})}
            >
              {t("onlineWeb.hub.filterAll")}
            </button>
            {curricula.map((c) => (
              <button
                key={c.code}
                type="button"
                className={chip(search.curriculum === c.code)}
                aria-pressed={search.curriculum === c.code}
                onClick={() => setFilter({ curriculum: c.code })}
              >
                {lang === "ar" ? c.name_ar : c.name_en}
              </button>
            ))}
            {DIRECTORY_TRACKS.map((track) => (
              <button
                key={track}
                type="button"
                className={chip(search.track === track)}
                aria-pressed={search.track === track}
                onClick={() => setFilter({ track })}
              >
                {t(track === "quran" ? "onlineWeb.hub.trackQuran" : "onlineWeb.hub.trackMusic")}
              </button>
            ))}
          </div>
        )}
      </div>

      {tutorsQ.isError ? (
        <QueryError onRetry={() => void tutorsQ.refetch()} />
      ) : tutorsQ.isLoading || match.loading || (base.length > 0 && capsQ.isLoading) ? (
        <ul
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-label={t("common.loading")}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <ProviderCardSkeleton />
            </li>
          ))}
        </ul>
      ) : match.active && results.length === 0 ? (
        match.emptyState
      ) : results.length === 0 ? (
        <EmptyState
          title={
            filterActive || q
              ? t("onlineWeb.hub.emptyFilteredTitle")
              : t("onlineWeb.hub.noTutorsTitle")
          }
          body={
            filterActive || q
              ? t("onlineWeb.hub.emptyFilteredBody")
              : t("onlineWeb.hub.noTutorsBody")
          }
          action={
            filterActive || q ? (
              <PrimaryButton
                type="button"
                className="h-12 px-6"
                onClick={() => {
                  setQ("");
                  setFilter({});
                }}
              >
                {t("onlineWeb.hub.showAll")}
              </PrimaryButton>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="text-pro-13 font-bold text-muted-foreground">
            {t("onlineWeb.hub.resultsCount", { count: results.length })}
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((p) => (
              <li key={p.id} className="min-w-0">
                <Link
                  to={
                    match.active
                      ? "/online/tutors/$providerId/request"
                      : "/online/tutors/$providerId"
                  }
                  params={{ providerId: p.id }}
                  search={match.active ? match.requestSearch(p.id) : undefined}
                  className="focus-ring flex h-full flex-col gap-4 rounded-3xl border border-border/60 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <ProfileAvatar
                      src={p.avatar}
                      name={p.name}
                      className="h-16 w-16 rounded-2xl text-pro-20"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-pro-16 font-extrabold">
                        <span className="truncate">{p.name || t("provider2.unnamed")}</span>
                        {p.badges.includes("ID Verified") ? (
                          <ShieldCheck
                            className="h-4 w-4 shrink-0 text-success"
                            aria-label={t("onlineWeb.hub.verified")}
                          />
                        ) : null}
                      </p>
                      {match.active && match.badge ? (
                        <p className="mt-1 text-pro-12 font-bold text-brand">{match.badge}</p>
                      ) : null}
                      {p.reviews > 0 ? (
                        <p className="mt-1 flex items-center gap-1 text-pro-13 text-muted-foreground">
                          <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
                          <span className="font-bold text-foreground">
                            {formatNumber(Number(p.rating.toFixed(1)), i18n.language)}
                          </span>
                          <span aria-hidden>·</span>
                          {t("providerPage.reviewCount", { count: p.reviews })}
                        </p>
                      ) : (
                        <p className="mt-1 text-pro-13 font-bold text-muted-foreground">
                          {t("providerPage.newOnFamy")}
                        </p>
                      )}
                      <TutorLessonsCount providerId={p.id} />
                    </div>
                  </div>
                  {bioSnippet(p.bio) ? (
                    <p className="line-clamp-2 text-pro-14 leading-relaxed text-muted-foreground">
                      {bioSnippet(p.bio)}
                    </p>
                  ) : null}
                  {p.summary.subjects.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {p.summary.subjects.slice(0, 4).map((s) => (
                        <li
                          key={s.code}
                          className="rounded-full bg-brand/10 px-2.5 py-1 text-pro-12 font-bold text-brand"
                        >
                          {lang === "ar" ? s.nameAr : s.nameEn}
                        </li>
                      ))}
                      {p.summary.subjects.length > 4 ? (
                        <li className="rounded-full bg-surface-2 px-2.5 py-1 text-pro-12 font-bold text-muted-foreground">
                          +{p.summary.subjects.length - 4}
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                  {p.summary.curricula.length ? (
                    <p className="text-pro-13 text-muted-foreground">
                      {p.summary.curricula
                        .map((c) => (lang === "ar" ? c.nameAr : c.nameEn))
                        .join(" · ")}
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/50 pt-3">
                    <span className="text-pro-15 font-extrabold text-foreground">
                      {match.active && p.minPrice !== null
                        ? t("providerPage.perSession", { price: formatEGP(p.minPrice) })
                        : p.summary.minPrice !== null
                          ? t("onlineWeb.hub.fromPrice", { price: formatEGP(p.summary.minPrice) })
                          : formatEGP(p.hourlyRate, { perHour: true })}
                    </span>
                    {p.summary.durations.length ? (
                      <span className="flex items-center gap-1 text-pro-12 text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" strokeWidth={ICON_STROKE} aria-hidden />
                        {t("onlineWeb.hub.durationMin", { count: p.summary.durations[0] })}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="text-pro-13 text-muted-foreground">
        {t("onlineWeb.tutors.inPersonCta")}{" "}
        <a href="/" className="font-bold text-brand underline-offset-2 hover:underline">
          {t("site.nav.home")}
        </a>
      </p>
    </div>
  );
}

/** «12 حصة على فامي» under the rating; nothing until there is at least one completed lesson. */
function TutorLessonsCount({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const stats = useProviderTrustStats(providerId);
  const badge = cardCompletedCount(stats.data, true);
  if (!badge) return null;
  return <p className="mt-0.5 text-pro-12 font-bold text-success">{trustBadgeText(t, badge)}</p>;
}
