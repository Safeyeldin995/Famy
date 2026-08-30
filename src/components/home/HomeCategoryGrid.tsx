import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { QueryError } from "@/components/famio/QueryError";
import { CategoryIcon } from "@/components/home/CategoryIcon";
import { formatEGP } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

type CategoryItem = {
  id: string;
  title: string;
  fromPrice: number;
};

export function HomeCategoryGrid({
  categories,
  loading,
  error,
  onRetry,
}: {
  categories: CategoryItem[];
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();

  if (!loading && error && onRetry) {
    return (
      <section className="px-5 pt-4">
        <QueryError compact onRetry={onRetry} />
      </section>
    );
  }

  return (
    <section className="px-5 pt-4">
      <div className="grid grid-cols-2 gap-3">
        {categories.map((category) => (
          <Link
            key={category.id}
            to="/category/$id"
            params={{ id: category.id }}
            className="focus-ring tap-scale flex min-h-[9rem] flex-col justify-between rounded-[1.5rem] bg-surface p-4 shadow-sm border border-border/50 transition-all hover:border-brand/30"
          >
            <div className="flex items-start justify-between">
              <CategoryIcon slug={category.id} className="h-12 w-12" />
              <div className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-muted-foreground">
                <ArrowRight className="h-3 w-3 rtl-flip" />
              </div>
            </div>
            <div>
              <p className="line-clamp-2 text-sm font-bold leading-tight text-foreground">{category.title}</p>
              <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                {t("common.from")} {formatEGP(category.fromPrice, { perHour: true })}
              </p>
            </div>
          </Link>
        ))}
        {loading
          ? Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="min-h-[9rem] animate-pulse rounded-[1.5rem] bg-surface-2" />
            ))
          : null}
      </div>
    </section>
  );
}
