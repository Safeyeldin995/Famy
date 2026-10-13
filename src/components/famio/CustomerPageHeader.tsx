import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { previewPath } from "@/lib/preview/previewPath";

export function CustomerPageHeader({ title, subtitle, backTo, right }: {
  title: string; subtitle?: string; backTo?: string; right?: ReactNode;
}) {
  const { t } = useTranslation();
  return <header className="safe-top border-b border-border/60 bg-white px-5 py-4">
    <div className="flex items-center gap-3">
      {backTo && <Link to={previewPath(backTo)} aria-label={t("common.back")} className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60"><ArrowLeft className="h-5 w-5 rtl-flip" /></Link>}
      <div className="min-w-0 flex-1"><h1 className="break-words text-pro-22 font-bold">{title}</h1>{subtitle && <p className="mt-1 text-pro-13 text-muted-foreground">{subtitle}</p>}</div>
      {right}
    </div>
  </header>;
}
