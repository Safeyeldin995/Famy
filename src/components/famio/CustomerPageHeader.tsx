import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useCustomerPreviewPath } from "@/components/famio/useCustomerPreviewPath";

export function CustomerPageHeader({
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
  const previewPath = useCustomerPreviewPath();
  return (
    <header className="safe-top border-b border-border/60 bg-white px-5 py-4">
      <div className="flex items-center gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={t("common.back")}
            className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60"
          >
            <ArrowLeft className="h-5 w-5 rtl-flip" />
          </button>
        ) : backTo ? (
          <Link
            to={previewPath(backTo)}
            aria-label={t("common.back")}
            className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60"
          >
            <ArrowLeft className="h-5 w-5 rtl-flip" />
          </Link>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-pro-22 font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-pro-13 text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}
