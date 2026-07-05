import { Link } from "@tanstack/react-router";
import { Star, ShieldCheck, Clock, Award } from "lucide-react";
import type { Provider } from "@/lib/mock/data";
import { formatEGP, formatNumber } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export function ProviderCard({ p }: { p: Provider }) {
  const { t } = useTranslation();
  const roleKey = p.role === "Angel" ? "roles.angel" : "roles.professional";
  const isKidsLike = p.category === "babysitting" || p.category === "kids";
  const subtitleKey = isKidsLike ? "categories.kidsSubtitle" : "categories.homeSubtitle";
  const isTopPro = p.rating >= 4.9;
  return (
    <Link
      to="/provider/$id"
      params={{ id: p.id }}
      aria-label={`${p.name}, ${p.rating} stars, ${formatEGP(p.hourlyRate, { perHour: true })}`}
      className="focus-ring relative block rounded-3xl bg-surface p-4 shadow-soft active:scale-[0.99] transition-transform"
    >
      {isTopPro && (
        <span className="absolute -top-2 start-4 inline-flex items-center gap-1 rounded-full bg-navy px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-navy-foreground shadow-soft">
          <Award className="h-3 w-3" /> {t("roles.topPro")}
        </span>
      )}
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <img
            src={p.avatar}
            alt={p.name}
            loading="lazy"
            className="h-16 w-16 rounded-2xl object-cover"
          />
          <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-success text-white ring-2 ring-surface" title={t("common.verified")}>
            <ShieldCheck className="h-3 w-3" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-bold text-foreground">{p.name}</h3>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              p.role === "Angel" ? "bg-coral/10 text-coral" : "bg-navy/10 text-navy"
            }`}>{t(roleKey)}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t(subtitleKey)} · {formatNumber(p.yearsExp)} {t("common.yrs")}
          </p>
          <div className="mt-1.5 flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
              <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden="true" /> {formatNumber(p.rating)}
              <span className="text-muted-foreground font-normal">({formatNumber(p.reviews)})</span>
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden="true" /> {t("common.replyTime")}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.badges.slice(0, 2).map((b) => (
              <span
                key={b}
                className="inline-flex items-center gap-1 rounded-full bg-mint/25 px-2 py-0.5 text-[10px] font-semibold text-foreground"
              >
                <ShieldCheck className="h-2.5 w-2.5 text-success" aria-hidden="true" /> {t(`badges.${badgeKey(b)}`, b)}
              </span>
            ))}
          </div>
        </div>
        <div className="text-end">
          <div className="text-base font-extrabold text-navy">{formatEGP(p.hourlyRate)}</div>
          <div className="text-[11px] text-muted-foreground">{t("common.perHour")}</div>
        </div>
      </div>
    </Link>
  );
}

function badgeKey(b: string) {
  return b.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function ProviderTile({ p }: { p: Provider }) {
  const { t } = useTranslation();
  const isTopPro = p.rating >= 4.9;
  const roleKey = p.role === "Angel" ? "roles.angel" : "roles.professional";
  return (
    <Link
      to="/provider/$id"
      params={{ id: p.id }}
      aria-label={`${p.name}, ${p.rating} stars`}
      className="focus-ring block w-44 shrink-0 overflow-hidden rounded-3xl bg-surface shadow-soft active:scale-[0.98] transition-transform"
    >
      <div className="relative h-40 w-full overflow-hidden">
        <img
          src={p.avatar}
          alt={p.name}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        {isTopPro && (
          <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-navy/90 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur">
            <Award className="h-2.5 w-2.5" /> {t("roles.topPro")}
          </span>
        )}
        <div className="absolute inset-x-2 bottom-2 flex items-center justify-between">
          <span className="rounded-full bg-black/55 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">
            ★ {formatNumber(p.rating)}
          </span>
          <span className={`rounded-full px-2 py-1 text-[10px] font-bold backdrop-blur ${
            p.role === "Angel" ? "bg-coral/90 text-coral-foreground" : "bg-navy/90 text-navy-foreground"
          }`}>{t(roleKey)}</span>
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-center gap-1">
          <span className="truncate text-sm font-bold">{p.name}</span>
          <ShieldCheck className="h-3 w-3 shrink-0 text-success" aria-label={t("common.verified")} />
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{formatEGP(p.hourlyRate, { perHour: true })} · {formatNumber(p.yearsExp)} {t("common.yrs")}</div>
      </div>
    </Link>
  );
}
