import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Bell, MapPin, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";

export function HomeHeroPanel({
  greeting,
  firstName,
  location,
  unread,
  searchHint,
  headline,
}: {
  greeting: string;
  firstName: string;
  location: string;
  unread: boolean;
  searchHint: string;
  headline: string;
}) {
  const { t } = useTranslation();

  return (
    <header className="home-ink-panel safe-top px-5 pb-10 pt-3 text-ink-foreground">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex min-h-11 max-w-[72%] items-center gap-2 rounded-full bg-white/12 px-3.5 py-2 backdrop-blur-sm">
          <MapPin className="h-4 w-4 shrink-0 text-brand" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
          <span className="truncate text-sm font-semibold">{location}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageToggle variant="hero" />
          <Link
            to="/notifications"
            aria-label={t("common.notifications")}
            className="focus-ring tap-scale relative grid h-11 w-11 min-h-11 min-w-11 place-items-center rounded-full bg-white/12 backdrop-blur-sm"
          >
            <Bell className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden="true" />
            {unread ? (
              <span className="absolute end-2 top-2 h-2 w-2 rounded-full bg-brand ring-2 ring-ink" aria-hidden="true" />
            ) : null}
          </Link>
        </div>
      </div>

      <div className="mt-10">
        <p className="text-sm font-medium text-white/75">
          {t("home.greetingLine", { timeGreeting: greeting, firstName })}
        </p>
        <h1 className="mt-3 max-w-[17rem] text-[2rem] font-extrabold leading-[1.08] tracking-tight text-white">
          {headline}
        </h1>
      </div>

      <Link
        to="/search"
        aria-label={t("common.search")}
        className="focus-ring tap-scale mt-8 flex min-h-[3.75rem] items-center gap-3 rounded-[1.125rem] bg-white px-4 text-ink shadow-[0_16px_48px_-20px_oklch(0_0_0_/_0.55)]"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/12">
          <Search className="h-5 w-5 text-brand" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
        </span>
        <span className="flex-1 text-base font-medium text-muted-foreground">{searchHint}</span>
        <ArrowUpRight className="h-5 w-5 shrink-0 text-brand rtl-flip" strokeWidth={ICON_STROKE} aria-hidden="true" />
      </Link>
    </header>
  );
}
