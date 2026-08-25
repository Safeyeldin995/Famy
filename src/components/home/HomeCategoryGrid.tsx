import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CategoryIllustration } from "@/components/home/CategoryIllustration";
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
      <h2 className="text-title text-foreground">{t("home.chooseService")}</h2>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {categories.map((category) => (
          <Link
            key={category.id}
            to="/category/$id"
            params={{ id: category.id }}
            className="focus-ring tap-scale flex min-h-[9.5rem] flex-col items-center justify-between rounded-[1.375rem] bg-surface px-3 py-4 text-center shadow-sm"
          >
            <CategoryIllustration slug={category.id} className="h-[4.5rem] w-[4.5rem]" />
            <div className="mt-2 w-full">
              <p className="line-clamp-2 text-sm font-bold leading-tight text-foreground">{category.title}</p>
              <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                {t("common.from")} {formatEGP(category.fromPrice, { perHour: true })}
              </p>
            </div>
          </Link>
        ))}
        {loading
          ? Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="min-h-[9.5rem] animate-pulse rounded-[1.375rem] bg-muted" />
            ))
          : null}
      </div>
    </section>
  );
}
