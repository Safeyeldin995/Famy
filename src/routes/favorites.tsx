import { createFileRoute, Link } from "@tanstack/react-router";
import { PhoneFrame, EmptyState } from "@/components/famio/ui";
import { CustomerPageHero } from "@/components/famio/CustomerPageHero";
import { ProviderListRow, ProviderRatingMeta } from "@/components/famio/ProviderListRow";
import { useFavorites } from "@/lib/db/queries";
import { toUIProvider } from "@/lib/db/adapters";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatEGP } from "@/lib/utils";

export const Route = createFileRoute("/favorites")({ component: Favorites });

function Favorites() {
  const { t } = useTranslation();
  const q = useFavorites();
  const saved = useMemo(
    () =>
      (q.data ?? [])
        .map((r: { provider?: unknown }) => r.provider)
        .filter(Boolean)
        .map(toUIProvider),
    [q.data],
  );

  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHero title={t("favs.title")} subtitle={t("favs.emptyBody")} backTo="/profile" />
      <div className="space-y-2.5 px-5 pb-12 pt-2">
        {q.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-[2rem] bg-surface-2" />
          ))
        ) : q.isError ? (
          <EmptyState icon="alert" title={t("common.errorTitle")} body={t("common.tryAgain")} />
        ) : saved.length === 0 ? (
          <EmptyState
            icon="heart"
            title={t("favs.emptyTitle")}
            body={t("favs.emptyBody")}
            action={
              <Link
                to="/home"
                className="focus-ring inline-flex h-11 items-center rounded-full bg-brand px-6 text-sm font-extrabold text-brand-foreground"
              >
                {t("favs.browse")}
              </Link>
            }
          />
        ) : (
          saved.map((p) => (
            <ProviderListRow
              key={p.id}
              to="/provider/$id"
              params={{ id: p.id }}
              avatar={p.avatar}
              name={p.name}
              subtitle={formatEGP(p.hourlyRate, { perHour: true })}
              meta={<ProviderRatingMeta rating={p.rating} reviews={p.reviews} />}
              trailing={
                <span className="shrink-0 rounded-full bg-brand px-3.5 py-2 text-[11px] font-extrabold text-brand-foreground">
                  {t("provider.bookNow")}
                </span>
              }
            />
          ))
        )}
      </div>
    </PhoneFrame>
  );
}
