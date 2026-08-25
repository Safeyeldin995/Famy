import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/famio/ui";
import { formatEGP } from "@/lib/utils";
import { HomeSection } from "./HomeSection";

type CategoryItem = {
  id: string;
  title: string;
  description: string;
  icon: string;
  tint: string;
  fromPrice: number;
};

export function HomeCategories({
  categories,
  loading,
  error,
}: {
  categories: CategoryItem[];
  loading: boolean;
  error: boolean;
}) {
  const { t } = useTranslation();

  return (
    <HomeSection title={t("home.chooseService")} subtitle={t("home.servicesSubtitle", "Services")}>
      <div className="grid grid-cols-2 gap-3 px-5">
        {categories.map((category) => (
          <Link
            key={category.id}
            to="/category/$id"
            params={{ id: category.id }}
            className="focus-ring surface-card group flex min-h-[8.75rem] flex-col p-4 active:scale-[0.98] transition-transform"
          >
            <div
              className="grid h-12 w-12 place-items-center rounded-2xl text-xl transition-transform group-active:scale-95"
              style={{ background: category.tint }}
            >
              {category.icon}
            </div>
            <div className="mt-auto pt-3">
              <div className="flex items-start justify-between gap-1">
                <span className="text-body font-bold leading-snug text-foreground">{category.title}</span>
                <ChevronRight
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-60 rtl-flip"
                  aria-hidden="true"
                />
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                {category.description.slice(0, 48)}
              </p>
              <p className="mt-2 text-[11px] font-semibold text-navy">
                {t("common.from")} {formatEGP(category.fromPrice, { perHour: true })}
              </p>
            </div>
          </Link>
        ))}
        {loading
          ? Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="surface-card h-[8.75rem] animate-pulse bg-surface-2" />
            ))
          : null}
      </div>
      {error ? (
        <div className="mt-3 px-5">
          <EmptyState
            emoji="⚠️"
            title={t("common.errorTitle", "Something went wrong")}
            body={t("common.tryAgain", "Please try again.")}
          />
        </div>
      ) : null}
    </HomeSection>
  );
}
