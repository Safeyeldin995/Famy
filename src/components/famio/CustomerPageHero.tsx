import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { previewPath } from "@/lib/preview/previewPath";

export function CustomerPageHero({
  title,
  subtitle,
  backTo,
  onBack,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  onBack?: () => void;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const backClass =
    "focus-ring tap-scale grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/25 bg-white/15 text-white backdrop-blur-sm";

  const resolvedBackTo = backTo ? previewPath(backTo) : undefined;
  const hasBack = Boolean(resolvedBackTo || onBack);

  return (
    <header className="brand-hero safe-top relative overflow-hidden rounded-b-[2.5rem] px-5 pb-14 pt-3">
      <span
        className="pointer-events-none absolute -end-16 -top-20 h-56 w-56 rounded-full bg-white/15 blur-2xl"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -start-14 bottom-0 h-40 w-40 rounded-full bg-white/10 blur-2xl"
        aria-hidden="true"
      />

      <div className="relative z-10 flex items-center justify-between gap-3">
        {resolvedBackTo ? (
          <Link
            to={resolvedBackTo}
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

      <div className={`relative z-10 ${hasBack || right ? "mt-4" : "mt-1"}`}>
        <h1 className="text-[1.75rem] font-extrabold leading-[1.15] tracking-tight text-white">
          {title}
        </h1>
        {subtitle ? <p className="mt-2 text-sm font-medium text-white/75">{subtitle}</p> : null}
        {children}
      </div>
    </header>
  );
}
