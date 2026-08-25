import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

export function HomeTrustBanner() {
  const { t } = useTranslation();

  return (
    <div className="surface-card mx-5 overflow-hidden">
      <div className="bg-gradient-to-br from-navy/[0.07] via-surface to-coral/[0.06] p-5">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface shadow-xs">
            <ShieldCheck className="h-6 w-6 text-navy" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-body font-extrabold text-foreground">{t("home.whyTrust")}</h3>
            <p className="mt-1.5 text-caption leading-relaxed">{t("home.whyTrustBody")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
