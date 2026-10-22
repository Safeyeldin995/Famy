import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessageSquare, Phone } from "lucide-react";
import { PhoneFrame, PrimaryButton } from "@/components/famio/ui";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { useSupportContact } from "@/lib/db/queries";
import { useProPath } from "@/lib/provider/useProPath";

const ZONE_CHANGE_PREFILL_AR = "طلب تعديل مناطق الخدمة";
const ZONE_CHANGE_PREFILL_EN = "Request to change my service areas";

export const Route = createFileRoute("/pro/support")({
  validateSearch: (search: Record<string, unknown>) => ({
    subject: typeof search.subject === "string" ? search.subject : undefined,
  }),
  component: ProSupportRoute,
});

function digits(v: string) {
  return v.replace(/[^\d+]/g, "");
}

function ProSupportRoute() {
  const { t, i18n } = useTranslation();
  const proPath = useProPath();
  const { subject } = Route.useSearch();
  const contact = useSupportContact();
  const prefill =
    subject?.trim() ||
    (i18n.language.startsWith("ar") ? ZONE_CHANGE_PREFILL_AR : ZONE_CHANGE_PREFILL_EN);

  const openWhatsapp = () => {
    const base = `https://wa.me/${digits(contact.data?.whatsapp ?? "").replace("+", "")}`;
    window.open(`${base}?text=${encodeURIComponent(prefill)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <ProviderShell hideNav>
      <PhoneFrame bg="bg-background">
        <div className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">{t("pro.support.body")}</p>
          <div className="rounded-2xl bg-surface-2 p-4 text-sm font-semibold">{prefill}</div>
          <PrimaryButton className="w-full" onClick={openWhatsapp} disabled={contact.isLoading}>
            <MessageSquare className="me-2 inline h-4 w-4" />
            {t("pro.support.whatsapp")}
          </PrimaryButton>
          <a
            href={`tel:${digits(contact.data?.phone ?? "")}`}
            className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border text-sm font-bold"
          >
            <Phone className="h-4 w-4" />
            {t("pro.support.call")}
          </a>
          <Link to={proPath("/pro/profile") as "/pro/profile"} className="block text-center text-sm font-bold text-brand">
            {t("common.back")}
          </Link>
        </div>
      </PhoneFrame>
    </ProviderShell>
  );
}
