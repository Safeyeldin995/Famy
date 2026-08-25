import { Link } from "@tanstack/react-router";
import { Bell, MapPin, Search, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "@/components/famio/LanguageToggle";

export function HomeHero({
  greeting,
  firstName,
  location,
  unread,
  searchHint,
  trustLabels,
}: {
  greeting: string;
  firstName: string;
  location: string;
  unread: boolean;
  searchHint: string;
  trustLabels: [string, string, string];
}) {
  const { t } = useTranslation();

  return (
    <div className="home-hero-bg safe-top px-5 pb-2 pt-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-caption font-medium">{greeting}</p>
          <h1 className="text-display mt-1 truncate text-foreground">{firstName}</h1>
          <div className="mt-2.5 inline-flex max-w-full min-h-11 items-center gap-1.5 rounded-full border border-border/60 bg-surface/90 px-3.5 py-2 shadow-xs backdrop-blur-sm">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-coral" aria-hidden="true" />
            <span className="truncate text-caption font-semibold text-foreground">{location}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageToggle variant="inline" />
          <Link
            to="/notifications"
            aria-label={t("common.notifications")}
            className="focus-ring surface-card relative grid h-11 w-11 min-h-11 min-w-11 shrink-0 place-items-center rounded-2xl active:scale-95 transition-transform"
          >
            <Bell className="h-5 w-5 text-foreground" aria-hidden="true" />
            {unread ? (
              <span
                className="absolute end-2.5 top-2.5 h-2 w-2 rounded-full bg-coral ring-2 ring-surface"
                aria-hidden="true"
              />
            ) : null}
          </Link>
        </div>
      </div>

      <Link
        to="/search"
        aria-label={t("common.search")}
        className="focus-ring mt-5 flex min-h-14 items-center gap-3 rounded-full border border-border/70 bg-surface px-4 shadow-sm active:scale-[0.99] transition-transform"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-navy/[0.07]">
          <Search className="h-[18px] w-[18px] text-navy" aria-hidden="true" />
        </span>
        <span className="text-body text-muted-foreground">{searchHint}</span>
      </Link>

      <div className="-mx-5 mt-4 overflow-x-auto no-scrollbar">
        <div className="flex gap-2 px-5 pb-1">
          {trustLabels.map((label, index) => (
            <span
              key={label}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-surface/95 px-3.5 py-2 text-[11px] font-semibold text-foreground shadow-xs"
            >
              {index === 0 ? (
                <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-coral/80" aria-hidden="true" />
              )}
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
