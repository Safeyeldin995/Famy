import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PrimaryButton } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { useAuth } from "@/lib/auth/useAuth";
import { useMyProvider } from "@/lib/db/provider-queries";
import { OnlineWebTutorAccountNotice } from "@/components/online/OnlineWebTutorAccountNotice";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { useProvider, useProviderReviews } from "@/lib/db/queries";
import { toUIProvider, providerPriceLabel } from "@/lib/db/adapters";
import { formatDate, formatEGP, formatLocale, formatNumber } from "@/lib/format";
import { Clock, ShieldCheck, Star } from "lucide-react";
import { useApprovedTeachingCapabilities } from "@/lib/db/teaching-queries";
import { currentLang } from "@/lib/i18n";
import { useOnlineCancellationPolicySummary } from "@/lib/online/useOnlineCancellationPolicy";
import {
  NO_CURRICULUM_CODE,
  summarizeTutorTeaching,
  type DirectoryCapability,
} from "@/lib/online/onlineTutorDirectory";
import { ONLINE_WEB_ROUTE_IDS, onlineWebTutorRequestPath } from "@/lib/web/onlineWebSurface";
import { stashOnlineWebReturnTo } from "@/lib/web/onlineWebReturnTo";

export const Route = createFileRoute("/online/tutors/$providerId/")({
  component: OnlineTutorProfile,
});

function OnlineTutorProfile() {
  const { providerId } = Route.useParams();
  const { t, i18n } = useTranslation();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const myProviderQ = useMyProvider();
  // Tutor accounts can't book, and the customer-only profile RPC refuses them:
  // show a clear notice instead of an error.
  const isTutorAccount = isAuthenticated && Boolean(myProviderQ.data?.id);
  const roleKnown = !authLoading && (!isAuthenticated || !myProviderQ.isLoading);
  const providerQ = useProvider(
    roleKnown && !isTutorAccount ? providerId : undefined,
    undefined,
    "online",
  );
  const reviewsQ = useProviderReviews(providerId);
  const capsQ = useApprovedTeachingCapabilities(roleKnown && !isTutorAccount ? providerId : undefined);
  const caps = capsQ.data ?? [];
  const summary = summarizeTutorTeaching(caps as DirectoryCapability[]);
  const policy = useOnlineCancellationPolicySummary();
  const lang = currentLang();
  const requestPath = onlineWebTutorRequestPath(providerId);

  if (!roleKnown) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]" aria-busy="true" aria-label={t("common.loading")}>
        <div className="skeleton h-64 rounded-3xl" />
        <div className="skeleton h-48 rounded-3xl" />
      </div>
    );
  }

  if (isTutorAccount) {
    return (
      <div className="space-y-6 rounded-3xl bg-white p-6 shadow-sm">
        <OnlineProfileBackLink />
        <OnlineWebTutorAccountNotice />
      </div>
    );
  }

  if (providerQ.isError) {
    return <QueryError onRetry={() => void providerQ.refetch()} />;
  }

  if (providerQ.isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]" aria-busy="true" aria-label={t("common.loading")}>
        <div className="skeleton h-64 rounded-3xl" />
        <div className="skeleton h-48 rounded-3xl" />
      </div>
    );
  }

  if (!providerQ.data) {
    return (
      <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
        <OnlineProfileBackLink />
        <p className="text-pro-16 font-bold text-foreground">{t("onlineWeb.profile.unavailableTitle")}</p>
        <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.profile.unavailableBody")}</p>
      </div>
    );
  }

  const ui = toUIProvider(providerQ.data);
  const priceLabel = providerPriceLabel(ui, t);
  const bookCta = isAuthenticated ? (
    <Link to="/online/tutors/$providerId/request" params={{ providerId }} className="block">
      <PrimaryButton className="h-12 w-full">{t("onlineWeb.walkthrough.requestLesson")}</PrimaryButton>
    </Link>
  ) : (
    <Link
      to={ONLINE_WEB_ROUTE_IDS.login}
      search={{ returnTo: requestPath }}
      onClick={() => stashOnlineWebReturnTo(requestPath)}
      className="block"
    >
      <PrimaryButton className="h-12 w-full">{t("onlineWeb.walkthrough.requestLesson")}</PrimaryButton>
    </Link>
  );

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <OnlineProfileBackLink />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <ProfileAvatar src={ui.avatar} name={ui.name} className="h-20 w-20 rounded-2xl text-pro-24" />
              <div className="min-w-0 flex-1">
                <h1 className="flex items-center gap-2 text-pro-24 font-extrabold">
                  <span className="truncate">{ui.name || t("provider2.unnamed")}</span>
                  {ui.badges.includes("ID Verified") ? (
                    <ShieldCheck className="h-5 w-5 shrink-0 text-success" aria-label={t("onlineWeb.hub.verified")} />
                  ) : null}
                </h1>
                <p className="mt-1 flex items-center gap-1 text-pro-14 text-muted-foreground">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
                  {formatNumber(ui.rating, i18n.language)}
                  <span aria-hidden>·</span>
                  {t("onlineWeb.profile.reviews", { count: reviewsQ.data?.length ?? ui.reviews })}
                </p>
                {summary.subjects.length ? (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {summary.subjects.map((s) => (
                      <li key={s.code} className="rounded-full bg-brand/10 px-2.5 py-1 text-pro-12 font-bold text-brand">
                        {lang === "ar" ? s.nameAr : s.nameEn}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-pro-18 font-extrabold">{t("onlineWeb.hub.aboutTitle")}</h2>
            <p className="whitespace-pre-line text-pro-15 leading-relaxed text-muted-foreground">
              {ui.bio || t("onlineWeb.hub.noBio")}
            </p>
          </section>

          <section className="space-y-3 rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-pro-18 font-extrabold">{t("onlineWeb.hub.teachesTitle")}</h2>
            {capsQ.isLoading ? (
              <div className="skeleton h-24 rounded-2xl" aria-busy="true" />
            ) : caps.length === 0 ? (
              <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.hub.noTeaching")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-start text-pro-14">
                  <thead>
                    <tr className="border-b border-border/60 text-pro-12 text-muted-foreground">
                      <th className="py-2 text-start font-bold">{t("onlineWeb.hub.colSubject")}</th>
                      <th className="py-2 text-start font-bold">{t("onlineWeb.hub.colCurriculum")}</th>
                      <th className="py-2 text-start font-bold">{t("onlineWeb.hub.colLevel")}</th>
                      <th className="py-2 text-start font-bold">{t("onlineWeb.hub.colDuration")}</th>
                      <th className="py-2 text-start font-bold">{t("onlineWeb.hub.colPrice")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caps.map((c) => (
                      <tr key={c.id} className="border-b border-border/40 last:border-0">
                        <td className="py-2.5 font-bold">{lang === "ar" ? c.subjectNameAr : c.subjectNameEn}</td>
                        <td className="py-2.5 text-muted-foreground">
                          {c.curriculumCode === NO_CURRICULUM_CODE ? "—" : lang === "ar" ? c.curriculumNameAr : c.curriculumNameEn}
                        </td>
                        <td className="py-2.5 text-muted-foreground">{lang === "ar" ? c.levelNameAr : c.levelNameEn}</td>
                        <td className="py-2.5 text-muted-foreground">
                          {t("onlineWeb.hub.durationMin", { count: c.durationMin })}
                        </td>
                        <td className="py-2.5 font-bold">{c.price > 0 ? formatEGP(c.price) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-pro-18 font-extrabold">{t("onlineWeb.hub.reviewsTitle")}</h2>
            {reviewsQ.isLoading ? (
              <div className="skeleton h-20 rounded-2xl" aria-busy="true" />
            ) : (reviewsQ.data ?? []).length === 0 ? (
              <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.hub.noReviews")}</p>
            ) : (
              <ul className="space-y-3">
                {(reviewsQ.data ?? []).map((r) => (
                  <li key={r.id} className="rounded-2xl bg-surface-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-0.5" aria-label={String(r.rating)}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-4 w-4 ${i < Number(r.rating) ? "fill-amber-400 text-amber-400" : "text-border"}`}
                            aria-hidden
                          />
                        ))}
                      </span>
                      <span className="text-pro-12 text-muted-foreground">
                        {formatDate(new Date(r.created_at), { day: "numeric", month: "short", year: "numeric" }, formatLocale(lang))}
                      </span>
                    </div>
                    {r.comment ? <p className="mt-2 text-pro-14 leading-relaxed text-foreground">{r.comment}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <section className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-pro-18 font-extrabold">{t("onlineWeb.hub.bookCardTitle")}</h2>
            <p className="text-pro-22 font-extrabold text-foreground">
              {summary.minPrice !== null
                ? t("onlineWeb.hub.fromPrice", { price: formatEGP(summary.minPrice) })
                : priceLabel}
            </p>
            {summary.durations.length ? (
              <p className="flex items-center gap-1.5 text-pro-14 text-muted-foreground">
                <Clock className="h-4 w-4" aria-hidden />
                {summary.durations.map((d) => t("onlineWeb.hub.durationMin", { count: d })).join(" · ")}
              </p>
            ) : null}
            <p className="text-pro-13 leading-relaxed text-muted-foreground">{t("onlineWeb.hub.bookCardBody")}</p>
            <div className="hidden lg:block">{bookCta}</div>
          </section>
          <section className="space-y-2 rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-pro-16 font-extrabold">{t("onlineWeb.hub.policyTitle")}</h2>
            <p className="text-pro-13 leading-relaxed text-muted-foreground">{policy.summary}</p>
          </section>
        </aside>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-white/95 px-4 py-3 backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        {bookCta}
      </div>
    </div>
  );
}

function OnlineProfileBackLink() {
  const { t } = useTranslation();
  return (
    <Link
      to={ONLINE_WEB_ROUTE_IDS.tutors}
      className="focus-ring inline-flex text-pro-14 font-bold text-brand"
    >
      {t("common.back")}
    </Link>
  );
}