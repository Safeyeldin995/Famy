import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, MessageCircle, Phone } from "lucide-react";
import { SiteLayout, SiteSection } from "@/components/site/SiteLayout";
import { siteHead, siteLanguage } from "@/lib/site/seo";
import { useSupportContact } from "@/lib/db/queries";

export const Route = createFileRoute("/help")({
  head: ({ matches }) =>
    siteHead(
      "/help",
      {
        ar: {
          title: "المساعدة | فامي",
          description: "إجابات الأسئلة اللي بتتسأل كتير عن فامي، وطرق التواصل مع فريق الدعم.",
        },
        en: {
          title: "Help | Famy",
          description: "Answers to common questions about Famy and ways to reach our support team.",
        },
      },
      siteLanguage(matches),
    ),
  component: Help,
});

const digits = (v: string) => v.replace(/[^\d+]/g, "");

function Help() {
  const { t } = useTranslation();
  const faqs = t("helpC.faqs", { returnObjects: true }) as { q: string; a: string }[];
  const contact = useSupportContact();
  const whatsapp = contact.data?.whatsapp ? digits(contact.data.whatsapp).replace("+", "") : null;
  const phone = contact.data?.phone ? digits(contact.data.phone) : null;

  return (
    <SiteLayout>
      <div className="bg-gradient-to-b from-brand/[0.08] to-white">
        <SiteSection className="py-16 md:py-20">
          <h1 className="text-[2.25rem] font-extrabold md:text-[3rem]">{t("helpC.title")}</h1>
          <p className="mt-5 max-w-3xl text-pro-18 leading-relaxed text-muted-foreground">
            {t("helpC.heroBody")}
          </p>
          {whatsapp || phone ? (
            <div className="mt-8 flex flex-wrap gap-3">
              {whatsapp ? (
                <a
                  href={`https://wa.me/${whatsapp}`}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-full bg-brand px-6 text-pro-16 font-extrabold text-brand-foreground"
                >
                  <MessageCircle className="h-5 w-5" aria-hidden="true" />
                  {t("helpC.whatsapp")}
                </a>
              ) : null}
              {phone ? (
                <a
                  href={`tel:${phone}`}
                  className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-full border border-border/80 bg-white px-6 text-pro-16 font-extrabold"
                >
                  <Phone className="h-5 w-5" aria-hidden="true" />
                  <span dir="ltr">{phone}</span>
                </a>
              ) : null}
            </div>
          ) : null}
        </SiteSection>
      </div>
      <SiteSection className="pb-20">
        <h2 className="text-pro-24 font-extrabold">{t("helpC.faqsTitle")}</h2>
        <div className="mt-6 max-w-3xl divide-y divide-border/70 rounded-3xl border border-border/70">
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
        <p className="mt-8 text-pro-14 text-muted-foreground">
          {t("helpC.moreHelp")}{" "}
          <Link to="/contact" className="focus-ring font-bold text-brand">
            {t("site.nav.contact")}
          </Link>
        </p>
      </SiteSection>
    </SiteLayout>
  );
}
