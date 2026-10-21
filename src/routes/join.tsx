import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CalendarClock, MapPin, Smartphone } from "lucide-react";
import { SiteLayout, SiteSection } from "@/components/site/SiteLayout";
import { siteHead, siteLanguage } from "@/lib/site/seo";

export const Route = createFileRoute("/join")({
  head: ({ matches }) =>
    siteHead(
      "/join",
      {
        ar: {
          title: "انضم لفامي | قدم خدمات رعاية الأطفال أو التدريس",
          description:
            "قدم للانضمام لفامي كمقدم خدمة رعاية أطفال أو تدريس، وحدد خدماتك ومناطق عملك.",
        },
        en: {
          title: "Join Famy | Apply as a babysitter or tutor",
          description:
            "Apply to offer babysitting or tutoring through Famy and choose your services and coverage areas.",
        },
      },
      siteLanguage(matches),
    ),
  component: Join,
});

function Join() {
  const { t } = useTranslation();
  const benefits = [
    { icon: CalendarClock, title: "site.join.benefit1Title", body: "site.join.benefit1Body" },
    { icon: MapPin, title: "site.join.benefit2Title", body: "site.join.benefit2Body" },
    { icon: Smartphone, title: "site.join.benefit3Title", body: "site.join.benefit3Body" },
  ];
  const steps = ["site.join.step1", "site.join.step2", "site.join.step3", "site.join.step4"];
  return (
    <SiteLayout>
      <div className="bg-gradient-to-b from-brand/[0.08] to-white">
        <SiteSection className="py-16 md:py-20">
          <h1 className="text-[2.25rem] font-extrabold md:text-[3rem]">{t("site.join.title")}</h1>
          <p className="mt-5 max-w-3xl text-pro-18 leading-relaxed text-muted-foreground">
            {t("site.join.lead")}
          </p>
          <Link
            to="/login"
            className="focus-ring mt-8 inline-flex min-h-13 items-center rounded-2xl bg-brand px-7 py-3.5 text-pro-16 font-extrabold text-brand-foreground shadow-card"
          >
            {t("site.join.cta")}
          </Link>
        </SiteSection>
      </div>

      <SiteSection className="pb-16">
        <h2 className="text-pro-24 font-extrabold">{t("site.join.benefitsTitle")}</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-3">
          {benefits.map((b) => (
            <div key={b.title} className="rounded-3xl border border-border/70 p-6">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand">
                <b.icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-pro-16 font-extrabold">{t(b.title)}</h3>
              <p className="mt-2 text-pro-14 leading-relaxed text-muted-foreground">{t(b.body)}</p>
            </div>
          ))}
        </div>
      </SiteSection>

      <div className="bg-surface-2/60">
        <SiteSection className="py-16">
          <h2 className="text-pro-24 font-extrabold">{t("site.join.stepsTitle")}</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-2">
            {steps.map((key, i) => (
              <li key={key} className="flex items-start gap-4 rounded-3xl bg-white p-6 shadow-sm">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-pro-16 font-extrabold text-brand-foreground">
                  {i + 1}
                </span>
                <p className="pt-2 text-pro-16 font-bold leading-relaxed">{t(key)}</p>
              </li>
            ))}
          </ol>
          <Link
            to="/login"
            className="focus-ring mt-8 inline-flex min-h-13 items-center rounded-2xl bg-brand px-7 py-3.5 text-pro-16 font-extrabold text-brand-foreground"
          >
            {t("site.join.cta")}
          </Link>
        </SiteSection>
      </div>
    </SiteLayout>
  );
}
