import { createFileRoute, Link } from "@tanstack/react-router";
import { PhoneFrame, TopBar, EmptyState } from "@/components/famio/ui";
import { ProviderCard } from "@/components/famio/ProviderCard";
import { useFavorites } from "@/lib/db/queries";
import { toUIProvider } from "@/lib/db/adapters";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/favorites")({ component: Favorites });

function Favorites() {
  const { t } = useTranslation();
  const q = useFavorites();
  const saved = useMemo(
    () => (q.data ?? []).map((r: any) => r.provider).filter(Boolean).map(toUIProvider),
    [q.data],
  );

  return (
    <PhoneFrame>
      <TopBar back={{ to: "/profile" }} title={t("favs.title")} />
      <div className="space-y-3 px-5 pb-10">
        {q.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-3xl bg-surface animate-pulse" />)
        ) : q.isError ? (
          <EmptyState emoji="⚠️" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
        ) : saved.length === 0 ? (
          <EmptyState
            emoji="💖"
            title={t("favs.emptyTitle")}
            body={t("favs.emptyBody")}
            action={
              <Link to="/home" className="focus-ring inline-flex h-11 items-center rounded-2xl bg-navy px-5 text-sm font-bold text-navy-foreground">
                {t("favs.browse")}
              </Link>
            }
          />
        ) : (
          saved.map((p) => <ProviderCard key={p.id} p={p} />)
        )}
      </div>
    </PhoneFrame>
  );
}
