import { Headphones, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON_STROKE } from "@/lib/icons/constants";

export function HomeTrustLine() {
  const { t } = useTranslation();
  const items = [
    { icon: ShieldCheck, label: t("home.trust1") },
    { icon: Sparkles, label: t("home.trust2") },
    { icon: Headphones, label: t("home.trust3") },
  ] as const;

  return (
    <div className="mt-8 border-t border-border/70 px-5 py-6">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {items.map(({ icon: Icon, label }) => (
          <span key={label} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Icon className="h-3.5 w-3.5 text-brand" strokeWidth={ICON_STROKE} aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
