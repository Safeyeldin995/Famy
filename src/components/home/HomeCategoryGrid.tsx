import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { QueryError } from "@/components/famio/QueryError";
import { CategoryIllustration } from "@/components/home/CategoryIllustration";
import { categoryTint } from "@/components/home/categoryTint";
import { formatEGP } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

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

  if (loading) {
    return (
      <section className="grid grid-cols-2 gap-3 px-5">
        <div className="col-span-2 h-32 animate-pulse rounded-[1.75rem] bg-surface-2" />
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-40 animate-pulse rounded-[1.75rem] bg-surface-2" />
        ))}
      </section>
    );
  }

  const [lead, ...rest] = categories;

  return (
    <section className="grid grid-cols-2 gap-3 px-5">
      {lead ? (
        <Link
          key={lead.id}
          to="/category/$id"
          params={{ id: lead.id }}
          className={`focus-ring tap-scale relative col-span-2 flex min-h-[8rem] items-center overflow-hidden rounded-[1.75rem] p-5 shadow-sm ${categoryTint(lead.id)}`}
        >
          <div className="relative z-10 min-w-0 flex-1">
            <p className="text-xl font-extrabold leading-tight">{lead.title}</p>
            <p className="mt-1 text-xs font-bold opacity-70">
              {t("common.from")} {formatEGP(lead.fromPrice, { perHour: true })}
            </p>
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-[11px] font-extrabold text-brand-foreground">
              {t("home.exploreServices")}
              <ArrowRight
                className="h-3 w-3 rtl-flip"
                strokeWidth={ICON_STROKE_BOLD}
                aria-hidden="true"
              />
            </span>
          </div>
          <CategoryIllustration slug={lead.id} className="h-32 w-32 shrink-0 drop-shadow-sm" />
        </Link>
      ) : null}

      {rest.map((category) => (
        <Link
          key={category.id}
          to="/category/$id"
          params={{ id: category.id }}
          className={`focus-ring tap-scale relative flex min-h-[9.5rem] flex-col justify-end overflow-hidden rounded-[1.75rem] p-4 shadow-sm ${categoryTint(category.id)}`}
        >
          <CategoryIllustration
            slug={category.id}
            className="pointer-events-none absolute -top-1 end-1 h-24 w-24 opacity-95"
          />
          <p className="relative z-10 line-clamp-2 text-[0.95rem] font-extrabold leading-tight">
            {category.title}
          </p>
          <div className="relative z-10 mt-1 flex items-end justify-between gap-2">
            <p className="text-[11px] font-bold opacity-70">
              {t("common.from")} {formatEGP(category.fromPrice, { perHour: true })}
            </p>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface/85 shadow-xs">
              <ArrowRight
                className="h-3.5 w-3.5 rtl-flip"
                strokeWidth={ICON_STROKE_BOLD}
                aria-hidden="true"
              />
            </span>
          </div>
        </Link>
      ))}
    </section>
  );
}
