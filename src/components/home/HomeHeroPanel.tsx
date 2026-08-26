import { Link } from "@tanstack/react-router";
import { Bell, ChevronDown, Search } from "lucide-react";
import { Headphones, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TrustChip } from "@/components/famio/ui";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";

export function HomeHeroPanel({
  greeting,
  firstName,
  location,
  unread,
  searchHint,
}: {
  greeting: string;
  firstName: string;
  location: string;
  unread: boolean;
  searchHint: string;
}) {
  const { t } = useTranslation();
  const trustItems = [
    { icon: ShieldCheck, label: t("home.trust1") },
    { icon: Sparkles, label: t("home.trust2") },
    { icon: Headphones, label: t("home.trust3") },
  ] as const;

  return (
    <header className="home-hero-shell safe-top px-5 pb-2 pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.625rem] font-extrabold leading-tight tracking-tight text-foreground">
            {t("home.greetingLine", { timeGreeting: greeting, firstName })}
          </h1>
          <Link
            to="/addresses"
            className="focus-ring tap-scale mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-surface px-3.5 py-2 text-sm font-semibold text-foreground shadow-xs"
          >
            <span className="truncate">{location}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={ICON_STROKE} aria-hidden="true" />
          </Link>
        </div>
        <Link
          to="/notifications"
          aria-label={t("common.notifications")}
          className="focus-ring tap-scale relative grid h-11 w-11 min-h-11 min-w-11 shrink-0 place-items-center rounded-full bg-surface shadow-soft"
        >
          <Bell className="h-5 w-5 text-foreground" strokeWidth={ICON_STROKE} aria-hidden="true" />
          {unread ? (
            <span className="absolute end-2 top-2 h-2 w-2 rounded-full bg-brand ring-2 ring-surface" aria-hidden="true" />
          ) : null}
        </Link>
      </div>

      <Link
        to="/search"
        aria-label={t("common.search")}
        className="focus-ring tap-scale mt-5 flex min-h-[3.5rem] items-center gap-3 rounded-[1.125rem] border border-border/70 bg-surface px-4 shadow-sm"
      >
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
        <span className="flex-1 text-base font-medium text-muted-foreground">{searchHint}</span>
      </Link>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {trustItems.map(({ icon: Icon, label }) => (
          <TrustChip key={label} tone="success" icon={<Icon className="h-3 w-3 text-success" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />}>
            {label}
          </TrustChip>
        ))}
      </div>
    </header>
  );
}
