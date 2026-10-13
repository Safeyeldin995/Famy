import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Star } from "lucide-react";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { useTranslation } from "react-i18next";
import { StatusPill } from "@/components/famio/ui";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { formatNumber } from "@/lib/format";
import { isPreviewRoute } from "@/lib/preview/constants";

export function ProviderListRow({
  to,
  params,
  avatar,
  name,
  subtitle,
  meta,
  pill,
  trailing,
  className = "",
}: {
  to: string;
  params?: Record<string, string>;
  avatar: string | null | undefined;
  name: string;
  subtitle?: string;
  meta?: ReactNode;
  pill?: { label: string; tone?: "brand" | "ink" | "success" | "muted" | "warning" };
  trailing?: ReactNode;
  className?: string;
}) {
  const resolvedTo =
    isPreviewRoute() && to === "/provider/$id" ? "/preview/provider/$id" : to;

  return (
    <Link
      to={resolvedTo as any}
      params={params as any}
      className={`focus-ring tap-scale flex items-center gap-4 rounded-2xl border border-border/50 bg-white p-4 shadow-sm transition-shadow hover:shadow-md hover:border-brand/30 ${className}`}
    >
      <ProfileAvatar src={avatar} name={name} className="h-14 w-14 rounded-full text-pro-18" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-pro-16 font-extrabold text-foreground">{name}</p>
          {pill ? <StatusPill tone={pill.tone ?? "brand"}>{pill.label}</StatusPill> : null}
        </div>
        {subtitle ? (
          <p className="mt-0.5 truncate text-pro-13 font-bold text-brand">{subtitle}</p>
        ) : null}
        {meta ? (
          <div className="mt-1.5 flex items-center gap-1 text-pro-13 font-bold text-muted-foreground">
            {meta}
          </div>
        ) : null}
      </div>
      {trailing}
    </Link>
  );
}

export function ProviderRatingMeta({ rating, reviews }: { rating: number; reviews?: number }) {
  const { t } = useTranslation();
  if (!reviews) return <span>{t("providerPage.newOnFamy")}</span>;
  return (
    <>
      <Star
        className="h-3.5 w-3.5 fill-warning text-warning"
        strokeWidth={ICON_STROKE_BOLD}
        aria-hidden="true"
      />
      <span>{formatNumber(rating)}</span>
      {reviews != null ? (
        <span className="font-normal text-muted-foreground">({formatNumber(reviews)})</span>
      ) : null}
    </>
  );
}
