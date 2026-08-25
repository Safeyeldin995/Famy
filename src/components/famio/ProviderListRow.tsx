import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Star } from "lucide-react";
import { Avatar } from "@/components/famio/ui";
import { StatusPill } from "@/components/famio/ui";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { formatNumber } from "@/lib/utils";

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
  return (
    <Link
      to={to as any}
      params={params as any}
      className={`focus-ring tap-scale flex min-h-[4.75rem] items-center gap-3 rounded-[1.25rem] bg-surface px-3 py-3 shadow-sm ${className}`}
    >
      <Avatar src={avatar} alt={name} className="h-14 w-14 shrink-0 rounded-full ring-2 ring-surface-2" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-bold text-foreground">{name}</p>
          {pill ? <StatusPill tone={pill.tone ?? "brand"}>{pill.label}</StatusPill> : null}
        </div>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
        {meta ? <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-foreground">{meta}</div> : null}
      </div>
      {trailing}
    </Link>
  );
}

export function ProviderRatingMeta({ rating, reviews }: { rating: number; reviews?: number }) {
  return (
    <>
      <Star className="h-3.5 w-3.5 fill-warning text-warning" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
      <span>{formatNumber(rating)}</span>
      {reviews != null ? <span className="font-normal text-muted-foreground">({formatNumber(reviews)})</span> : null}
    </>
  );
}
