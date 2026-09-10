import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { proPath } from "@/lib/preview/previewPath";

export function ProviderPageHero({
  title,
  subtitle,
  backTo,
  onBack,
  right,
  children,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  onBack?: () => void;
  right?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const backClass =
    "focus-ring tap-scale grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/25 bg-white/15 text-white backdrop-blur-sm";

  const hasBack = Boolean(backTo || onBack);

  return (
    <header
      className={`brand-hero safe-top relative overflow-hidden rounded-b-[2rem] px-5 ${compact ? "pb-8 pt-3" : "pb-10 pt-3"}`}
    >
      <span
        className="pointer-events-none absolute -end-16 -top-20 h-48 w-48 rounded-full bg-white/12 blur-2xl"
        aria-hidden="true"
      />

      <div className="relative z-10 flex items-center justify-between gap-3">
        {backTo ? (
          <Link
            to={proPath(backTo) as "/pro"}
            aria-label={t("common.back")}
            data-rtl-flip="true"
            className={backClass}
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
          </Link>
        ) : onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={t("common.back")}
            data-rtl-flip="true"
            className={backClass}
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
          </button>
        ) : (
          <span />
        )}
        {right ?? <span />}
      </div>

      <div className={`relative z-10 ${hasBack || right ? "mt-3" : "mt-1"}`}>
        <h1 className="break-words text-xl font-extrabold leading-snug tracking-tight text-white">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 break-words text-sm font-medium leading-snug text-white/80">
            {subtitle}
          </p>
        ) : null}
        {children}
      </div>
    </header>
  );
}
