import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Baby,
  CalendarCheck,
  ChevronDown,
  GraduationCap,
  Headphones,
  MapPin,
  MousePointerClick,
  ShieldCheck,
  Star,
  Wallet,
  HeartHandshake,
} from "lucide-react";
import { SiteLayout, SiteSection } from "@/components/site/SiteLayout";
import { StoreBadges } from "@/components/site/StoreBadges";
import { useServiceAreas } from "@/components/site/useServiceAreas";
import { supabase } from "@/integrations/supabase/client";
import heroImage from "@/assets/onboarding/slide-3-peace.png";
import appImage from "@/assets/onboarding/slide-2-booking.png";
import heroWebp from "@/assets/onboarding/slide-3-peace.webp";
import appWebp from "@/assets/onboarding/slide-2-booking.webp";
import { siteHead, siteLanguage, siteStructuredData } from "@/lib/site/seo";

export const Route = createFileRoute("/")({
  head: ({ matches }) => {
    const seo = siteHead(
      "/",
      {
        ar: {
          title: "فامي | جليسات أطفال ومدرسين خصوصيين في مصر",
          description:
            "احجز جليسة أطفال أو مدرس خصوصي في مناطق الخدمة المتاحة، وتابع الحجز والدفع والمحادثة من فامي.",
        },
        en: {
          title: "Famy | Babysitters and tutors in Egypt",
          description:
            "Find babysitters and tutors in available service areas. Book, pay and chat through Famy.",
        },
      },
      siteLanguage(matches),
    );
    return {
      ...seo,
      links: [...seo.links, { rel: "preload", as: "image", href: heroWebp, type: "image/webp" }],
      scripts: [{ type: "application/ld+json", children: JSON.stringify(siteStructuredData) }],
    };
  },
  component: Landing,
});

/** Public home page. Signed-in users go straight to the app. */
function Landing() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const areas = useServiceAreas();

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) navigate({ to: "/app", replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const faqs = t("helpC.faqs", { returnObjects: true }) as { q: string; a: string }[];

  return (
    <SiteLayout>
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-b from-brand/[0.08] via-brand/[0.03] to-white">
        <SiteSection className="grid items-center gap-10 py-14 md:grid-cols-2 md:py-20">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-pro-13 font-bold text-brand shadow-sm">
              <HeartHandshake className="h-4 w-4" aria-hidden="true" />
              {t("site.hero.eyebrow")}
            </span>
            <h1 className="text-[2.25rem] font-extrabold leading-[1.15] text-balance md:text-[3.25rem]">
              {t("site.hero.title")}
            </h1>
            <p className="max-w-xl text-pro-16 leading-relaxed text-muted-foreground md:text-pro-18">
              {t("site.hero.body")}
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/app"
                className="focus-ring inline-flex min-h-13 items-center rounded-2xl bg-brand px-7 py-3.5 text-pro-16 font-extrabold text-brand-foreground shadow-card"
              >
                {t("site.hero.primary")}
              </Link>
              <Link
                to="/join"
                className="focus-ring inline-flex min-h-13 items-center rounded-2xl border border-border bg-white px-7 py-3.5 text-pro-16 font-extrabold"
              >
                {t("site.hero.secondary")}
              </Link>
            </div>
            {areas.length ? (
              <p className="flex flex-wrap items-center gap-2 text-pro-14 font-semibold text-muted-foreground">
                <MapPin className="h-4 w-4 text-brand" aria-hidden="true" />
                {t("site.hero.areas")}
                {areas.map((a) => (
                  <span
                    key={a}
                    className="rounded-full bg-white px-3 py-1 font-bold text-foreground shadow-sm"
                  >
                    {a}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
          <div className="relative">
            <div
              className="absolute inset-6 -z-0 rounded-[3rem] bg-brand/10 blur-3xl"
              aria-hidden="true"
            />
            <picture>
              <source srcSet={heroWebp} type="image/webp" />
              <img
                src={heroImage}
                alt=""
                className="relative mx-auto w-full max-w-md rounded-[2.5rem] shadow-float"
                width={771}
                height={720}
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />
            </picture>
          </div>
        </SiteSection>
      </div>

      {/* Services */}
      <SiteSection className="py-16 md:py-20">
        <SectionHeading title={t("site.services.title")} body={t("site.services.body")} />
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <ServiceCard
            icon={Baby}
            tone="brand"
            title={t("categories.kidsSubtitle")}
            body={t("site.services.babysittingBody")}
            cta={t("site.services.cta")}
          />
          <ServiceCard
            icon={GraduationCap}
            tone="lavender"
            title={t("categories.tutorSubtitle")}
            body={t("site.services.tutoringBody")}
            cta={t("site.services.cta")}
          />
        </div>
      </SiteSection>

      {/* How it works */}
      <div className="bg-surface-2/60">
        <SiteSection className="py-16 md:py-20">
          <SectionHeading title={t("site.how.title")} />
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              { icon: MousePointerClick, title: "site.how.step1Title", body: "site.how.step1Body" },
              { icon: CalendarCheck, title: "site.how.step2Title", body: "site.how.step2Body" },
              { icon: ShieldCheck, title: "site.how.step3Title", body: "site.how.step3Body" },
            ].map((step, i) => (
              <li key={step.title} className="rounded-3xl bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-brand text-pro-16 font-extrabold text-brand-foreground">
                    {i + 1}
                  </span>
                  <step.icon className="h-6 w-6 text-brand" aria-hidden="true" />
                </div>
                <h3 className="mt-5 text-pro-18 font-extrabold">{t(step.title)}</h3>
                <p className="mt-2 text-pro-14 leading-relaxed text-muted-foreground">
                  {t(step.body)}
                </p>
              </li>
            ))}
          </ol>
        </SiteSection>
      </div>

      {/* Trust */}
      <SiteSection className="py-16 md:py-20">
        <SectionHeading title={t("site.trust.title")} />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: ShieldCheck,
              title: "site.trust.verifiedTitle",
              body: "site.trust.verifiedBody",
            },
            { icon: Star, title: "site.trust.ratingsTitle", body: "site.trust.ratingsBody" },
            { icon: Wallet, title: "site.trust.paymentTitle", body: "site.trust.paymentBody" },
            { icon: Headphones, title: "site.trust.supportTitle", body: "site.trust.supportBody" },
          ].map((item) => (
            <div key={item.title} className="rounded-3xl border border-border/70 p-6">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand">
                <item.icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-pro-16 font-extrabold">{t(item.title)}</h3>
              <p className="mt-2 text-pro-14 leading-relaxed text-muted-foreground">
                {t(item.body)}
              </p>
            </div>
          ))}
        </div>
      </SiteSection>

      {/* Providers band */}
      <SiteSection className="pb-16 md:pb-20">
        <div className="flex flex-col items-start gap-6 rounded-[2rem] bg-brand px-7 py-10 text-brand-foreground md:flex-row md:items-center md:justify-between md:px-12">
          <div className="max-w-2xl space-y-3">
            <h2 className="text-pro-24 font-extrabold text-balance md:text-pro-32">
              {t("site.providersBand.title")}
            </h2>
            <p className="text-pro-16 leading-relaxed text-white/85">
              {t("site.providersBand.body")}
            </p>
          </div>
          <Link
            to="/join"
            className="focus-ring inline-flex min-h-13 shrink-0 items-center rounded-2xl bg-white px-7 py-3.5 text-pro-16 font-extrabold text-brand"
          >
            {t("site.providersBand.cta")}
          </Link>
        </div>
      </SiteSection>

      {/* Download */}
      <div className="bg-surface-2/60">
        <SiteSection className="grid items-center gap-10 py-16 md:grid-cols-2 md:py-20">
          <picture className="md:order-2">
            <source srcSet={appWebp} type="image/webp" />
            <img
              src={appImage}
              alt=""
              className="mx-auto w-full max-w-sm rounded-[2.5rem] shadow-card"
              width={771}
              height={720}
              loading="lazy"
              decoding="async"
            />
          </picture>
          <div className="space-y-5">
            <h2 className="text-pro-32 font-extrabold text-balance">{t("site.download.title")}</h2>
            <p className="max-w-lg text-pro-16 leading-relaxed text-muted-foreground">
              {t("site.download.body")}
            </p>
            <StoreBadges />
            <Link
              to="/app"
              className="focus-ring inline-flex min-h-11 items-center text-pro-16 font-extrabold text-brand"
            >
              {t("site.download.useWeb")}
            </Link>
          </div>
        </SiteSection>
      </div>

      {/* FAQ */}
      <SiteSection className="py-16 md:py-20">
        <SectionHeading title={t("site.faq.title")} />
        <div className="mx-auto mt-10 max-w-3xl divide-y divide-border/70 rounded-3xl border border-border/70">
          {faqs.map((f) => (
            <details key={f.q} className="group px-6">
              <summary className="focus-ring flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 text-pro-16 font-extrabold">
                {f.q}
                <ChevronDown
                  className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="pb-5 text-pro-14 leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </SiteSection>
    </SiteLayout>
  );
}

export function SectionHeading({ title, body }: { title: string; body?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-pro-32 font-extrabold text-balance">{title}</h2>
      {body ? <p className="mt-3 text-pro-16 text-muted-foreground">{body}</p> : null}
    </div>
  );
}

function ServiceCard({
  icon: Icon,
  tone,
  title,
  body,
  cta,
}: {
  icon: typeof Baby;
  tone: "brand" | "lavender";
  title: string;
  body: string;
  cta: string;
}) {
  const surface = tone === "brand" ? "bg-brand/[0.07]" : "bg-lavender/[0.12]";
  const ink = tone === "brand" ? "text-brand" : "text-lavender";
  return (
    <div className={`flex flex-col gap-5 rounded-[2rem] p-7 ${surface}`}>
      <span className={`grid h-14 w-14 place-items-center rounded-2xl bg-white shadow-sm ${ink}`}>
        <Icon className="h-7 w-7" aria-hidden="true" />
      </span>
      <div>
        <h3 className="text-pro-22 font-extrabold">{title}</h3>
        <p className="mt-2 text-pro-16 leading-relaxed text-foreground/70">{body}</p>
      </div>
      <Link
        to="/app"
        className={`focus-ring mt-auto inline-flex min-h-11 items-center text-pro-16 font-extrabold ${ink}`}
      >
        {cta}
      </Link>
    </div>
  );
}
