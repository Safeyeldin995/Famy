import { Link } from "@tanstack/react-router";
import { ChevronRight, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, EmptyState } from "@/components/famio/ui";
import type { Provider } from "@/lib/mock/data";
import { ICON_STROKE } from "@/lib/icons/constants";
import { formatEGP } from "@/lib/utils";

export function HomeRebookRow({
  providers,
  loading,
  error,
}: {
  providers: Provider[];
  loading: boolean;
  error: boolean;
}) {
  const { t } = useTranslation();

  return (
    <section className="mt-8 px-5">
      <div className="mb-4 flex items-center gap-2">
        <RotateCcw className="h-4 w-4 text-brand" strokeWidth={ICON_STROKE} aria-hidden="true" />
        <h2 className="text-title text-foreground">{t("home.recent")}</h2>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="h-[4.5rem] animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon="alert"
          title={t("common.errorTitle")}
          body={t("common.tryAgain")}
        />
      ) : providers.length === 0 ? (
        <EmptyState icon="user" title={t("home.recentEmpty")} body={t("home.recentEmptyBody")} />
      ) : (
        <div className="space-y-2">
          {providers.map((provider) => (
            <Link
              key={provider.id}
              to="/provider/$id"
              params={{ id: provider.id }}
              className="focus-ring tap-scale flex min-h-[4.5rem] items-center gap-3 rounded-2xl border border-border/70 bg-surface px-3 py-3 shadow-xs"
            >
              <Avatar src={provider.avatar} alt={provider.name} className="h-14 w-14 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">{provider.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatEGP(provider.hourlyRate, { perHour: true })}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground rtl-flip" strokeWidth={ICON_STROKE} />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
