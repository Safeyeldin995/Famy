import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Bell, MapPin, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { CategoryIcon } from "@/lib/icons/categoryIcons";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { formatEGP } from "@/lib/utils";

type CategoryItem = {
  id: string;
  title: string;
  fromPrice: number;
};

export function HomeHeroPanel({
  greeting,
  firstName,
  location,
  unread,
  searchHint,
  headline,
  categories,
  categoriesLoading,
}: {
  greeting: string;
  firstName: string;
  location: string;
  unread: boolean;
  searchHint: string;
  headline: string;
  categories: CategoryItem[];
  categoriesLoading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <header className="home-hero-light safe-top px-5 pb-5 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="surface-card inline-flex min-h-11 max-w-[72%] items-center gap-2 rounded-full px-3.5 py-2 shadow-xs">
          <MapPin className="h-4 w-4 shrink-0 text-brand" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
          <span className="truncate text-sm font-semibold text-foreground">{location}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageToggle variant="inline" />
          <Link
            to="/notifications"
            aria-label={t("common.notifications")}
            className="focus-ring tap-scale surface-card relative grid h-11 w-11 min-h-11 min-w-11 place-items-center rounded-full shadow-xs"
          >
            <Bell className="h-5 w-5 text-foreground" strokeWidth={ICON_STROKE} aria-hidden="true" />
            {unread ? (
              <span
                className="absolute end-2 top-2 h-2 w-2 rounded-full bg-brand ring-2 ring-surface"
                aria-hidden="true"
              />
            ) : null}
          </Link>
        </div>
      </div>

      <div className="mt-7">
        <p className="text-caption font-medium">
          {greeting}, {firstName}
        </p>
        <h1 className="mt-2 max-w-[18rem] text-[1.75rem] font-extrabold leading-[1.12] tracking-tight text-foreground">
          {headline}
        </h1>
      </div>

      <Link
        to="/search"
        aria-label={t("common.search")}
        className="focus-ring tap-scale surface-card mt-5 flex min-h-[3.5rem] items-center gap-3 rounded-2xl px-4 shadow-sm"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10">
          <Search className="h-5 w-5 text-brand" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
        </span>
        <span className="flex-1 text-body text-muted-foreground">{searchHint}</span>
        <ArrowUpRight className="h-5 w-5 shrink-0 text-brand rtl-flip" strokeWidth={ICON_STROKE} aria-hidden="true" />
      </Link>

      <div className="mt-6">
        <p className="text-overline">{t("home.chooseService")}</p>
        <div className="-mx-5 mt-3 overflow-x-auto no-scrollbar">
          <div className="flex gap-2.5 px-5 pb-1">
            {categories.map((category) => (
              <Link
                key={category.id}
                to="/category/$id"
                params={{ id: category.id }}
                className="focus-ring tap-scale surface-card flex w-[5.75rem] shrink-0 flex-col items-center gap-2 rounded-2xl px-2 py-3 text-center shadow-xs"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand/10 text-brand">
                  <CategoryIcon slug={category.id} className="h-5 w-5" />
                </span>
                <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-foreground">
                  {category.title}
                </span>
                <span className="text-[10px] font-medium text-muted-foreground">
                  {t("common.from")} {formatEGP(category.fromPrice, { perHour: true })}
                </span>
              </Link>
            ))}
            {categoriesLoading
              ? Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="surface-card h-[7.25rem] w-[5.75rem] shrink-0 animate-pulse bg-muted/50"
                  />
                ))
              : null}
          </div>
        </div>
      </div>
    </header>
  );
}
