import { useTranslation } from "react-i18next";
import { ProviderListRow, ProviderRatingMeta } from "@/components/famio/ProviderListRow";
import { EmptyState } from "@/components/famio/ui";
import type { Provider } from "@/lib/mock/data";
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
      ) : error ? (
        <EmptyState icon="alert" title={t("common.errorTitle")} body={t("common.tryAgain")} />
      ) : providers.length === 0 ? (
        <EmptyState icon="user" title={t("home.recentEmpty")} body={t("home.recentEmptyBody")} />
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
