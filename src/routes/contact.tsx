import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessageCircle, Phone } from "lucide-react";
import { SiteLayout, SiteSection } from "@/components/site/SiteLayout";
import { useSupportContact } from "@/lib/db/queries";

export const Route = createFileRoute("/contact")({
  head: () => ({ meta: [{ title: "Contact Famy | تواصل مع فامي" }] }),
  component: Contact,
});

const digits = (v: string) => v.replace(/[^\d+]/g, "");

function Contact() {
  const { t } = useTranslation();
  const contact = useSupportContact();
  const phone = contact.data?.phone ? digits(contact.data.phone) : null;
  const whatsapp = contact.data?.whatsapp ? digits(contact.data.whatsapp).replace("+", "") : null;

  return (
    <SiteLayout>
      <div className="bg-gradient-to-b from-brand/[0.08] to-white">
        <SiteSection className="py-16 md:py-20">
          <h1 className="text-[2.25rem] font-extrabold md:text-[3rem]">
            {t("site.contact.title")}
          </h1>
          <p className="mt-5 max-w-3xl text-pro-18 leading-relaxed text-muted-foreground">
            {t("site.contact.lead")}
          </p>
        </SiteSection>
      </div>
      <SiteSection className="pb-20">
        {contact.isLoading ? (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="h-32 animate-pulse rounded-3xl bg-surface-2" />
            <div className="h-32 animate-pulse rounded-3xl bg-surface-2" />
          </div>
        ) : !phone && !whatsapp ? (
          <p className="rounded-3xl bg-surface-2 p-6 text-pro-16 text-muted-foreground">
            {t("site.contact.unavailable")}
          </p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {whatsapp ? (
              <ContactCard
                href={`https://wa.me/${whatsapp}`}
                icon={<MessageCircle className="h-6 w-6" aria-hidden="true" />}
                title={t("site.contact.whatsapp")}
                value={`+${whatsapp}`}
              />
            ) : null}
            {phone ? (
              <ContactCard
                href={`tel:${phone}`}
                icon={<Phone className="h-6 w-6" aria-hidden="true" />}
                title={t("site.contact.call")}
                value={phone}
              />
            ) : null}
          </div>
        )}
      </SiteSection>
    </SiteLayout>
  );
}

function ContactCard({
  href,
  icon,
  title,
  value,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  value: string;
}) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel="noreferrer"
      className="focus-ring flex items-center gap-5 rounded-3xl border border-border/70 p-6 transition-colors hover:border-brand/40"
    >
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand">
        {icon}
      </span>
      <span>
        <span className="block text-pro-18 font-extrabold">{title}</span>
        <span className="mt-1 block text-pro-16 font-bold text-muted-foreground" dir="ltr">
          {value}
        </span>
      </span>
    </a>
  );
}
