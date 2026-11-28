import { createFileRoute, Link } from "@tanstack/react-router";
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
  Video,
  Wallet,
  HeartHandshake,
} from "lucide-react";
import { SiteLayout, SiteSection } from "@/components/site/SiteLayout";
import { StoreBadges } from "@/components/site/StoreBadges";
import { useServiceAreas } from "@/components/site/useServiceAreas";
import heroImage from "@/assets/onboarding/slide-3-peace.png";
import appImage from "@/assets/onboarding/slide-2-booking.png";
import heroWebp from "@/assets/onboarding/slide-3-peace.webp";
import appWebp from "@/assets/onboarding/slide-2-booking.webp";
import { siteHead, siteLanguage, siteStructuredData } from "@/lib/site/seo";
import { LessonIllustration } from "@/components/lessons/LessonIllustration";

export const Route = createFileRoute("/")({
  head: ({ matches }) => {
    const seo = siteHead(
      "/",
      {
        ar: {
          title: "فامي | جليسات أطفال ومدرسين خصوصيين في مصر",
          description:
            "فامي بتربط العائلات بجليسات أطفال ومدرسين خصوصيين موثوقين في مصر. حمل التطبيق واحجز بأمان.",
        },
        en: {
          title: "Famy | Trusted babysitters and tutors in Egypt",
          description:
            "Famy connects families with trusted babysitters and private tutors in Egypt. Get the app to book safely.",
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

function Landing() {
  const { t } = useTranslation();
  const areas = useServiceAreas();
  const faqs = t("helpC.faqs", { returnObjects: true }) as { q: string; a: string }[];

  const iconBox = "grid h-16 w-16 shrink-0 place-items-center rounded-2xl";
  const doors = [
    {
      key: "tutoring",
      title: t("home.doors.tutorTitle"),
      body: t("home.doors.tutorBody"),
      art: (
        <span className={`${iconBox} bg-lavender/15 text-lavender`}>
          <GraduationCap className="h-8 w-8" aria-hidden="true" />
        </span>
      ),
      online: true,
    },
    {
      key: "quran",
      title: t("home.doors.quranTitle"),
      body: t("home.doors.quranBody"),
      art: (
        <span className={`${iconBox} overflow-hidden`}>
          <LessonIllustration serviceSlug="quran-lessons" className="h-16 w-16" />
        </span>
      ),
      online: true,
    },
    {
      key: "music",
      title: t("home.doors.musicTitle"),
      body: t("home.doors.musicBody"),
      art: (
        <span className={`${iconBox} overflow-hidden`}>
          <LessonIllustration serviceSlug="music-lessons" className="h-16 w-16" />
        </span>
      ),
      online: true,
    },
    {
      key: "babysitting",
      title: t("home.doors.babysitterTitle"),
      body: t("home.doors.babysitterBody"),
      art: (
        <span className={`${iconBox} bg-brand/10 text-brand`}>
          <Baby className="h-8 w-8" aria-hidden="true" />
        </span>
      ),
      online: false,
    },
  ];

  return (
    <SiteLayout>
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
            <StoreBadges />
            <Link
              to="/online"
              className="focus-ring inline-flex items-center gap-2 rounded-2xl border border-brand/25 bg-white px-5 py-3 text-pro-14 font-extrabold text-brand shadow-sm transition-colors hover:bg-brand/5"
            >
              <Video className="h-5 w-5" aria-hidden="true" />
              {t("site.hero.onlineLessons")}
            </Link>
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
                alt={t("site.hero.imageAlt")}
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

      <SiteSection className="py-16 md:py-20">
        <SectionHeading title={t("site.services.title")} body={t("site.services.body")} />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {doors.map((door) => (
            <article
              key={door.key}
              data-testid={`landing-door-${door.key}`}
              className="flex flex-col gap-4 rounded-[2rem] border border-border/60 bg-white p-6 shadow-sm"
            >
              {door.art}
              <div>
                <h3 className="text-pro-22 font-extrabold">{door.title}</h3>
                <p className="mt-2 text-pro-14 leading-relaxed text-muted-foreground">
                  {door.body}
                </p>
              </div>
              {door.online ? (
                <Link
                  to="/online"
                  className="focus-ring mt-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-pro-14 font-extrabold text-white shadow-sm"
                >
                  <Video className="h-5 w-5" aria-hidden="true" />
                  {t("home.doors.onlineCta")}
                </Link>
              ) : (
                <a
                  href="#download"
                  className="focus-ring mt-auto inline-flex min-h-12 items-center justify-center rounded-2xl border border-brand/25 bg-white px-4 text-pro-14 font-extrabold text-brand shadow-sm"
                >
                  {t("home.doors.appCta")}
                </a>
              )}
            </article>
          ))}
        </div>
      </SiteSection>

      <div className="bg-brand/[0.06]">
        <SiteSection className="grid items-center gap-8 py-14 md:grid-cols-[auto_1fr] md:py-16">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white text-brand shadow-sm">
            <Video className="h-8 w-8" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-pro-24 font-extrabold">{t("site.supervision.title")}</h2>
            <p className="mt-3 max-w-3xl text-pro-16 leading-relaxed text-muted-foreground">
              {t("site.supervision.body")}
            </p>
          </div>
        </SiteSection>
      </div>

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

      <div id="download" className="scroll-mt-20 bg-surface-2/60">
        <SiteSection className="grid items-center gap-10 py-16 md:grid-cols-2 md:py-20">
          <picture className="md:order-2">
            <source srcSet={appWebp} type="image/webp" />
            <img
              src={appImage}
              alt={t("site.download.imageAlt")}
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
          </div>
        </SiteSection>
      </div>

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
