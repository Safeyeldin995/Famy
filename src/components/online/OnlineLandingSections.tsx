import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronDown, GraduationCap, MapPin, Music, Sparkles } from "lucide-react";
import { PrimaryButton } from "@/components/famio/ui";
import { useTeachingCurricula } from "@/lib/db/teaching-queries";
import { currentLang } from "@/lib/i18n";
import { ICON_STROKE } from "@/lib/icons/constants";
import { useOnlineCancellationPolicySummary } from "@/lib/online/useOnlineCancellationPolicy";
import { NO_CURRICULUM_CODE, ONLINE_CURRICULA_FALLBACK } from "@/lib/online/onlineTutorDirectory";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";

/** Curricula grid (live taxonomy) plus the Quran and music tracks, linking into the tutors list. */
export function OnlineCurriculaGrid({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const lang = currentLang();
  // Visitors can't read the taxonomy table: use the same list from the code.
  const curriculaQ = useTeachingCurricula(false, signedIn);
  const live = (curriculaQ.data ?? []).filter((c) => c.code !== NO_CURRICULUM_CODE);
  const curricula = live.length ? live : ONLINE_CURRICULA_FALLBACK;
  const target = (search: { curriculum?: string; track?: "quran" | "music" }) =>
    signedIn
      ? { to: ONLINE_WEB_ROUTE_IDS.tutors, search }
      : {
          to: ONLINE_WEB_ROUTE_IDS.login,
          search: {
            returnTo: `${ONLINE_WEB_ROUTE_IDS.tutors}?${new URLSearchParams(search as Record<string, string>).toString()}`,
          },
        };

  return (
    <section className="space-y-6" aria-labelledby="online-curricula-title">
      <div className="space-y-2">
        <h2 id="online-curricula-title" className="text-pro-22 font-extrabold text-foreground">
          {t("onlineWeb.hub.curriculaTitle")}
        </h2>
        <p className="max-w-2xl text-pro-15 text-muted-foreground">{t("onlineWeb.hub.curriculaLead")}</p>
      </div>
      {signedIn && curriculaQ.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-20 rounded-2xl" />
          ))}
        </div>
      ) : curricula.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {curricula.map((c) => {
            const link = target({ curriculum: c.code });
            return (
              <li key={c.code}>
                <Link
                  to={link.to}
                  search={link.search as never}
                  className="focus-ring group flex h-full items-center gap-3 rounded-2xl border border-border/60 bg-surface p-4 shadow-sm transition-colors hover:border-brand/40"
                >
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <GraduationCap className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden />
                  </span>
                  <span className="min-w-0 text-pro-14 font-bold text-foreground">
                    {lang === "ar" ? c.name_ar : c.name_en}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            { track: "quran", Icon: BookOpen, title: "trackQuran", body: "trackQuranBody" },
            { track: "music", Icon: Music, title: "trackMusic", body: "trackMusicBody" },
          ] as const
        ).map(({ track, Icon, title, body }) => {
          const link = target({ track });
          return (
            <Link
              key={track}
              to={link.to}
              search={link.search as never}
              className="focus-ring flex items-center gap-4 rounded-3xl bg-surface p-5 shadow-sm transition-colors hover:bg-white"
            >
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-brand-foreground">
                <Icon className="h-6 w-6" strokeWidth={ICON_STROKE} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-pro-16 font-extrabold text-foreground">{t(`onlineWeb.hub.${title}`)}</span>
                <span className="mt-0.5 block text-pro-13 text-muted-foreground">{t(`onlineWeb.hub.${body}`)}</span>
              </span>
              <span className="text-pro-13 font-bold text-brand">{t("onlineWeb.hub.seeTutors")}</span>
            </Link>
          );
        })}
      </div>
      <p className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-pro-14 text-muted-foreground">
        <MapPin className="h-4 w-4 shrink-0 text-brand" strokeWidth={ICON_STROKE} aria-hidden />
        <span>
          <strong className="font-bold text-foreground">{t("onlineWeb.hub.everywhereTitle")}</strong>
          {" · "}
          {t("onlineWeb.hub.everywhereBody")}
        </span>
      </p>
    </section>
  );
}

/** FAQ with real policy answers; cancellation text comes from the live admin setting. */
export function OnlineLandingFaq() {
  const { t } = useTranslation();
  const policy = useOnlineCancellationPolicySummary();
  const items: { q: string; a: string }[] = [
    { q: t("onlineWeb.hub.faqHowQ"), a: t("onlineWeb.hub.faqHowA") },
    { q: t("onlineWeb.hub.faqPayQ"), a: t("onlineWeb.hub.faqPayA") },
    { q: t("onlineWeb.hub.faqCancelQ"), a: policy.summary },
    { q: t("onlineWeb.hub.faqRefundQ"), a: t("onlineWeb.hub.faqRefundA") },
    { q: t("onlineWeb.hub.faqMinorQ"), a: t("onlineWeb.hub.faqMinorA") },
    { q: t("onlineWeb.hub.faqWhereQ"), a: t("onlineWeb.hub.faqWhereA") },
  ];
  return (
    <section className="space-y-6" aria-labelledby="online-faq-title">
      <h2 id="online-faq-title" className="text-pro-22 font-extrabold text-foreground">
        {t("onlineWeb.hub.faqTitle")}
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {items.map((item) => (
          <details key={item.q} className="group rounded-2xl bg-surface p-5 shadow-sm">
            <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-3 text-pro-15 font-bold text-foreground">
              {item.q}
              <ChevronDown
                className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="mt-3 text-pro-14 leading-relaxed text-muted-foreground">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** Tutor recruiting band. */
export function OnlineTutorRecruit() {
  const { t } = useTranslation();
  return (
    <section className="rounded-3xl border border-brand/20 bg-brand/5 p-6 sm:p-10">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="flex items-center gap-2 text-pro-22 font-extrabold text-foreground">
            <Sparkles className="h-6 w-6 text-brand" strokeWidth={ICON_STROKE} aria-hidden />
            {t("onlineWeb.hub.recruitTitle")}
          </p>
          <p className="max-w-2xl text-pro-15 leading-relaxed text-muted-foreground">{t("onlineWeb.hub.recruitBody")}</p>
        </div>
        <Link to="/pro/apply" search={{} as never} className="shrink-0">
          <PrimaryButton variant="outline" className="h-12 px-7">
            {t("onlineWeb.hub.recruitCta")}
          </PrimaryButton>
        </Link>
      </div>
    </section>
  );
}
