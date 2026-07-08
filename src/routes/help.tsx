import { createFileRoute } from "@tanstack/react-router";
import { PhoneFrame, TopBar, Card } from "@/components/famio/ui";
import { MessageCircle, Phone, MessageSquare, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSupportContact } from "@/lib/db/queries";

export const Route = createFileRoute("/help")({ component: Help });

function digits(v: string) {
  return v.replace(/[^\d+]/g, "");
}

function Help() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(0);
  const faqs = t("helpC.faqs", { returnObjects: true }) as { q: string; a: string }[];
  const contact = useSupportContact();

  // Closed Beta business decision: support is handled entirely through
  // WhatsApp. Chat and WhatsApp both open the same conversation; Report
  // Serious Issue opens it with a pre-filled urgent message. Contact
  // details come from the existing Settings infrastructure (`settings`
  // table) — this assumes real production configuration exists;
  // configuration validity is a deployment/operations concern, not
  // application logic.
  const openWhatsapp = (prefill?: string) => {
    const base = `https://wa.me/${digits(contact.data?.whatsapp ?? "").replace("+", "")}`;
    window.open(prefill ? `${base}?text=${encodeURIComponent(prefill)}` : base, "_blank");
  };

  return (
    <PhoneFrame>
      <TopBar back={{ to: "/profile" }} title={t("helpC.title")} />
      <div className="px-5 pb-10">
        <Card className="p-5">
          <h2 className="text-lg font-extrabold">{t("helpC.heroTitle")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("helpC.heroBody")}</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Contact icon={<MessageCircle className="h-5 w-5" />} label={t("helpC.chat")} onClick={() => openWhatsapp()} />
            <Contact icon={<Phone className="h-5 w-5" />} label={t("helpC.call")} onClick={() => { window.location.href = `tel:${digits(contact.data?.phone ?? "")}`; }} />
            <Contact icon={<MessageSquare className="h-5 w-5" />} label={t("helpC.whatsapp")} onClick={() => openWhatsapp()} />
          </div>
        </Card>

        <h3 className="mt-6 mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("helpC.faqsTitle")}</h3>
        <div className="divide-y divide-border rounded-3xl bg-surface shadow-soft">
          {faqs.map((f, i) => (
            <button key={i} onClick={() => setOpen(open === i ? null : i)} className="block w-full px-4 py-4 text-start">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold">{f.q}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open === i ? "rotate-180" : ""}`} />
              </div>
              {open === i && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{f.a}</p>}
            </button>
          ))}
        </div>

        <button
          onClick={() => openWhatsapp(t("helpC.urgentPrefill"))}
          className="mt-4 w-full rounded-2xl bg-surface py-4 text-sm font-bold text-destructive shadow-soft"
        >
          {t("helpC.reportIssue")}
        </button>
      </div>
    </PhoneFrame>
  );
}

function Contact({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-2xl bg-surface-2 p-3 text-center active:scale-95">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-navy text-navy-foreground">{icon}</div>
      <div className="mt-1.5 text-[11px] font-bold">{label}</div>
    </button>
  );
}
