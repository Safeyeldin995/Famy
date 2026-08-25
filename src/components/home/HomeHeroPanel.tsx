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
    <header className="home-ink-panel safe-top rounded-b-[2rem] px-5 pb-6 pt-3 text-ink-foreground">
      <div className="flex items-center justify-between gap-3">
        <div className="focus-ring inline-flex min-h-11 max-w-[70%] items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-start backdrop-blur-sm">
          <MapPin className="h-4 w-4 shrink-0 text-brand" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
          <span className="truncate text-sm font-semibold">{location}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageToggle variant="inline" />
          <Link
            to="/notifications"
            aria-label={t("common.notifications")}
            className="focus-ring tap-scale relative grid h-11 w-11 min-h-11 min-w-11 place-items-center rounded-full bg-white/10 backdrop-blur-sm"
          >
            <Bell className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden="true" />
            {unread ? (
              <span
                className="absolute end-2 top-2 h-2 w-2 rounded-full bg-brand ring-2 ring-ink"
                aria-hidden="true"
              />
            ) : null}
          </Link>
        </div>
      </div>

      <div className="mt-8">
        <p className="text-sm font-medium text-white/70">{greeting}, {firstName}</p>
        <h1 className="mt-2 max-w-[16rem] text-[1.875rem] font-extrabold leading-[1.1] tracking-tight text-white">
          {headline}
        </h1>
      </div>

      <Link
        to="/search"
        aria-label={t("common.search")}
        className="focus-ring tap-scale mt-6 flex min-h-[3.75rem] items-center gap-3 rounded-2xl bg-white px-4 text-ink shadow-[0_12px_40px_-16px_oklch(0_0_0_/_0.45)]"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink/[0.06]">
          <Search className="h-5 w-5 text-ink" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
        </span>
        <span className="flex-1 text-base font-medium text-muted-foreground">{searchHint}</span>
        <ArrowUpRight className="h-5 w-5 shrink-0 text-brand rtl-flip" strokeWidth={ICON_STROKE} aria-hidden="true" />
      </Link>

      <div className="mt-6">
        <p className="text-overline text-white/55">{t("home.chooseService")}</p>
        <div className="-mx-5 mt-3 overflow-x-auto no-scrollbar">
          <div className="flex gap-2.5 px-5 pb-1">
            {categories.map((category) => (
              <Link
                key={category.id}
                to="/category/$id"
                params={{ id: category.id }}
                className="focus-ring tap-scale flex w-[5.75rem] shrink-0 flex-col items-center gap-2 rounded-2xl bg-white/8 px-2 py-3 text-center backdrop-blur-sm"
              >
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/12 text-brand transition-colors duration-200 group-active:bg-white/20">
                  <CategoryIcon slug={category.id} className="h-6 w-6" />
                </span>
                <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-white">
                  {category.title}
                </span>
                <span className="text-[10px] font-medium text-white/60">
                  {t("common.from")} {formatEGP(category.fromPrice, { perHour: true })}
                </span>
              </Link>
            ))}
            {categoriesLoading
              ? Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-[7.5rem] w-[5.75rem] shrink-0 animate-pulse rounded-2xl bg-white/10"
                  />
                ))
              : null}
          </div>
        </div>
      </div>
    </header>
  );
}
