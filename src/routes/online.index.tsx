import { createFileRoute, Link } from "@tanstack/react-router";
import { siteHead, siteLanguage } from "@/lib/site/seo";
import { useTranslation } from "react-i18next";
import { BadgeCheck, CalendarClock, CreditCard, Wallet, Video } from "lucide-react";
import { PrimaryButton } from "@/components/famio/ui";
import {
  OnlineHeroIllustration,
  StepChooseTutor,
  StepConfirmPay,
  StepJoinLesson,
} from "@/components/online/OnlineLandingIllustrations";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";
import { ICON_STROKE } from "@/lib/icons/constants";
import { useAuth } from "@/lib/auth/useAuth";
import { useMyProvider } from "@/lib/db/provider-queries";
import { OnlineStudentHome, OnlineTutorHome } from "@/components/online/OnlineHomeDashboards";
import {
  OnlineCurriculaGrid,
  OnlineLandingFaq,
  OnlineTutorRecruit,
} from "@/components/online/OnlineLandingSections";

export const Route = createFileRoute("/online/")({
  head: ({ matches }) =>
    siteHead(
      "/online",
      {
        ar: {
          title: "دروس أونلاين | فامي",
          description: "احجز درس خصوصي أونلاين مع مدرسين فامي الموثوقين من الموبايل أو الكمبيوتر، في كل مصر.",
        },
        en: {
          title: "Online lessons | Famy",
          description: "Book live online tutoring with verified Famy tutors from your computer.",
        },
      },
      siteLanguage(matches),
    ),
  component: OnlineHome,
});

const STEPS = [
  { key: "step1", Art: StepChooseTutor },
  { key: "step2", Art: StepConfirmPay },
  { key: "step3", Art: StepJoinLesson },
] as const;

const WHY = [
  { key: "whyVerified", Icon: BadgeCheck },
  { key: "whyPayment", Icon: CreditCard },
  { key: "whyCancel", Icon: CalendarClock },
  { key: "whyRefund", Icon: Wallet },
] as const;


function OnlineHome() {
  const { t } = useTranslation();
  const { isAuthenticated, loading } = useAuth();

  const myProviderQ = useMyProvider();
  const isTutor = isAuthenticated && Boolean(myProviderQ.data?.id);
  // The primary action follows the session: browse (student), requests (tutor),
  // or sign in (visitor). Never ask a signed-in user to sign in.
  const primary = !isAuthenticated
    ? {
        to: ONLINE_WEB_ROUTE_IDS.login,
        search: { returnTo: ONLINE_WEB_ROUTE_IDS.tutors },
        label: t("onlineWeb.home.browseTutorsSignIn"),
      }
    : isTutor
      ? { to: ONLINE_WEB_ROUTE_IDS.providerRequests, search: undefined, label: t("onlineWeb.home.tutorRequests") }
      : { to: ONLINE_WEB_ROUTE_IDS.tutors, search: undefined, label: t("onlineWeb.home.browseTutors") };
  const secondary = !isAuthenticated
    ? { to: ONLINE_WEB_ROUTE_IDS.login, search: { returnTo: undefined }, label: t("onlineWeb.home.signIn") }
    : isTutor
      ? { to: ONLINE_WEB_ROUTE_IDS.providerLessons, search: undefined, label: t("onlineWeb.home.tutorLessons") }
      : { to: ONLINE_WEB_ROUTE_IDS.lessons, search: undefined, label: t("onlineWeb.nav.lessons") };
  const sessionSettled = !loading && (!isAuthenticated || !myProviderQ.isLoading);

  const primaryCta = sessionSettled ? (
    <Link to={primary.to} search={primary.search as never}>
      <PrimaryButton className="h-12 px-7">{primary.label}</PrimaryButton>
    </Link>
  ) : (
    <PrimaryButton className="h-12 px-7" disabled aria-busy="true">
      {t("common.loading")}
    </PrimaryButton>
  );

  const ctas = (
    <div className="flex flex-wrap gap-3">
      {primaryCta}
      {sessionSettled ? (
        <Link to={secondary.to} search={secondary.search as never}>
          <PrimaryButton variant="outline" className="h-12 px-7">
            {secondary.label}
          </PrimaryButton>
        </Link>
      ) : null}
    </div>
  );

  if (sessionSettled && isTutor && myProviderQ.data?.id) {
    return (
      <div className="space-y-12">
        <OnlineTutorHome providerId={myProviderQ.data.id} />
        <OnlineLandingFaq />
      </div>
    );
  }

  if (sessionSettled && isAuthenticated) {
    return (
      <div className="space-y-12 lg:space-y-14">
        <OnlineStudentHome />
        <OnlineCurriculaGrid signedIn />
        <OnlineLandingFaq />
      </div>
    );
  }

  return (
    <div className="space-y-12 lg:space-y-16">
      <section className="overflow-hidden rounded-3xl bg-surface p-6 shadow-sm sm:p-10">
        <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-10">
          <div className="min-w-0 space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-pro-13 font-bold text-brand">
              <Video className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden="true" />
              {t("onlineWeb.home.badge")}
            </span>
            <h1 className="text-balance text-pro-24 font-extrabold leading-tight text-foreground lg:text-pro-32">
              {t("onlineWeb.home.title")}
            </h1>
            <p className="max-w-xl text-pro-16 leading-relaxed text-muted-foreground">
              {t("onlineWeb.home.lead")}
            </p>
            {ctas}
          </div>
          <div className="mx-auto w-full max-w-md lg:max-w-none">
            <OnlineHeroIllustration />
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-pro-22 font-extrabold text-foreground">{t("onlineWeb.home.howTitle")}</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map(({ key, Art }, i) => (
            <li key={key} className="flex min-w-0 flex-col items-start gap-3 rounded-3xl bg-surface p-6 shadow-sm">
              <div className="flex w-full justify-center rounded-2xl bg-surface-2 py-3">
                <Art />
              </div>
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-pro-13 font-bold text-brand-foreground">
                {i + 1}
              </span>
              <h3 className="text-pro-16 font-bold text-foreground">{t(`onlineWeb.home.${key}Title`)}</h3>
              <p className="text-pro-14 leading-relaxed text-muted-foreground">{t(`onlineWeb.home.${key}Body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-6">
        <h2 className="text-pro-22 font-extrabold text-foreground">{t("onlineWeb.home.whyTitle")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {WHY.map(({ key, Icon }) => (
            <div key={key} className="min-w-0 space-y-3 rounded-3xl bg-surface p-6 shadow-sm">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <Icon className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden="true" />
              </span>
              <h3 className="text-pro-16 font-bold text-foreground">{t(`onlineWeb.home.${key}Title`)}</h3>
              <p className="text-pro-14 leading-relaxed text-muted-foreground">{t(`onlineWeb.home.${key}Body`)}</p>
            </div>
          ))}
        </div>
      </section>

      <OnlineCurriculaGrid signedIn={false} />

      <OnlineLandingFaq />

      <OnlineTutorRecruit />

      <section className="rounded-3xl bg-ink p-6 text-ink-foreground sm:p-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <h2 className="text-pro-22 font-extrabold">{t("onlineWeb.home.ctaTitle")}</h2>
            <p className="text-pro-16 opacity-80">{t("onlineWeb.home.ctaBody")}</p>
          </div>
          <div className="shrink-0">{primaryCta}</div>
        </div>
      </section>
    </div>
  );
}
