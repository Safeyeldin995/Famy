import { useTranslation } from "react-i18next";
import { QueryError } from "@/components/famio/QueryError";
import { ProviderListRow, ProviderRatingMeta } from "@/components/famio/ProviderListRow";
import type { UIProvider } from "@/lib/db/adapters";
import { formatEGP } from "@/lib/utils";

export function HomeRebookRow({
  providers,
  loading,
  error,
  onRetry,
}: {
  providers: UIProvider[];
  loading: boolean;
  error: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();

  if (!loading && !error && providers.length === 0) return null;

  return (
    <section className="mt-8 px-5">
      <div className="mb-4">
        <p className="text-overline">{t("home.recentSubtitle")}</p>
        <h2 className="text-title mt-1 text-foreground">{t("home.recent")}</h2>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="h-[4.75rem] animate-pulse rounded-[1.25rem] bg-muted" />
          ))}
        </div>
      ) : error && onRetry ? (
        <QueryError compact onRetry={onRetry} />
      ) : (
        <div className="space-y-2">
          {providers.map((provider) => (
            <ProviderListRow
              key={provider.id}
              to="/provider/$id"
              params={{ id: provider.id }}
              avatar={provider.avatar}
              name={provider.name}
              subtitle={formatEGP(provider.hourlyRate, { perHour: true })}
              meta={<ProviderRatingMeta rating={provider.rating} />}
              pill={{ label: t("bookings.bookAgain"), tone: "ink" }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
