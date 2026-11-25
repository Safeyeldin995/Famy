import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BadgeCheck, CalendarClock, CreditCard, Wallet, Video } from "lucide-react";
import { PrimaryButton } from "@/components/famio/ui";
import {
  OnlineHeroIllustration,
  StepChooseTutor,
  StepConfirmPay,
  StepJoinLesson,
} from "@/components/online/OnlineLandingIllustrations";
import { ONLINE_WEB_ROUTE_IDS, ONLINE_WEB_WALLET_TERMS_AR } from "@/lib/web/onlineWebSurface";
import { currentLang } from "@/lib/i18n";
import { ICON_STROKE } from "@/lib/icons/constants";

export const Route = createFileRoute("/online/")({
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

const SUBJECTS = ["subjectSchool", "subjectHomework", "subjectQuran", "subjectMusic"] as const;

function OnlineHome() {
  const { t } = useTranslation();
  const walletTerms =
    currentLang() === "ar" ? ONLINE_WEB_WALLET_TERMS_AR : t("onlineWeb.walletTerms");

  const ctas = (
    <div className="flex flex-wrap gap-3">
      <Link to={ONLINE_WEB_ROUTE_IDS.tutors}>
        <PrimaryButton className="h-12 px-7">{t("onlineWeb.home.browseTutors")}</PrimaryButton>
      </Link>
      <Link to={ONLINE_WEB_ROUTE_IDS.login} search={{ returnTo: undefined }}>
        <PrimaryButton variant="outline" className="h-12 px-7">
          {t("onlineWeb.home.signIn")}
        </PrimaryButton>
      </Link>
    </div>
  );

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

      <section className="space-y-4">
        <h2 className="text-pro-22 font-extrabold text-foreground">{t("onlineWeb.home.subjectsTitle")}</h2>
        <ul className="flex flex-wrap gap-2">
          {SUBJECTS.map((key) => (
            <li
              key={key}
              className="rounded-full border border-border bg-surface px-4 py-2 text-pro-14 font-bold text-foreground"
            >
              {t(`onlineWeb.home.${key}`)}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-3xl bg-ink p-6 text-ink-foreground sm:p-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <h2 className="text-pro-22 font-extrabold">{t("onlineWeb.home.ctaTitle")}</h2>
            <p className="text-pro-16 opacity-80">{t("onlineWeb.home.ctaBody")}</p>
          </div>
          <Link to={ONLINE_WEB_ROUTE_IDS.tutors} className="shrink-0">
            <PrimaryButton className="h-12 px-7">{t("onlineWeb.home.browseTutors")}</PrimaryButton>
          </Link>
        </div>
      </section>

      <p className="text-pro-13 leading-relaxed text-muted-foreground">{walletTerms}</p>
    </div>
  );
}
