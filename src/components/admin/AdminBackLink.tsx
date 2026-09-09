import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

export function AdminBackLink({ to, label }: { to: string; label?: string }) {
  const { t } = useTranslation();
  return (
    <Link
      to={to as "/admin"}
      className="focus-ring mb-4 inline-flex items-center gap-1 text-xs font-bold text-brand"
    >
      <ChevronLeft className="h-4 w-4 rtl-flip" aria-hidden="true" />
      {label ?? t("common.back")}
    </Link>
  );
}
