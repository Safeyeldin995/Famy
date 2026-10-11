import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { proPath } from "@/lib/preview/previewPath";

export function PageHeader({
  title,
  subtitle,
  backTo,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const { t } = useTranslation();
  const backClass =
    "focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl text-foreground";
  const arrow = <ArrowLeft data-rtl-flip="true" className="h-5 w-5" aria-hidden="true" />;
  return (
    <header className="safe-top bg-white px-5 pb-5 pt-3 text-foreground">
      <div className="flex items-center gap-3">
        {backTo ? (
          <Link to={proPath(backTo) as "/pro"} aria-label={t("common.back")} className={backClass}>
            {arrow}
          </Link>
        ) : onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={t("common.back")}
            className={backClass}
          >
            {arrow}
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-pro-24 font-pro-heavy leading-snug">{title}</h1>
          {subtitle ? <p className="mt-1 text-pro-14 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {right}
      </div>
    </header>
  );
}
