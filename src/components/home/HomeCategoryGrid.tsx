import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CategoryIcon } from "@/components/home/CategoryIcon";
import { formatEGP } from "@/lib/utils";

type CategoryItem = {
  id: string;
  title: string;
  fromPrice: number;
};

export function HomeCategoryGrid({
  categories,
  loading,
}: {
  categories: CategoryItem[];
  loading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <section className="px-5 pt-6">
      <h2 className="text-lg font-extrabold tracking-tight text-foreground">{t("home.exploreServices")}</h2>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {categories.map((category) => (
          <Link
            key={category.id}
            to="/category/$id"
            params={{ id: category.id }}
            className="focus-ring tap-scale flex min-h-[8.75rem] flex-col items-start rounded-[1.25rem] bg-surface p-4 shadow-sm"
          >
            <CategoryIcon slug={category.id} />
            <p className="mt-3 line-clamp-2 text-sm font-bold leading-tight text-foreground">{category.title}</p>
            <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
              {t("common.from")} {formatEGP(category.fromPrice, { perHour: true })}
            </p>
          </Link>
        ))}
        {loading
          ? Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="min-h-[8.75rem] animate-pulse rounded-[1.25rem] bg-muted" />
            ))
          : null}
      </div>
    </section>
  );
}
