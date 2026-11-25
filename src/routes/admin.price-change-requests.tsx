import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { QueryError } from "@/components/famio/QueryError";
import { adminPriceChangeKindLabelAr } from "@/lib/admin/priceChangeQueue";
import { useAdminPriceChangeRequests } from "@/lib/db/admin-price-change-queries";
import { currentLang } from "@/lib/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/price-change-requests")({
  component: AdminPriceChangeRequestsList,
});

function AdminPriceChangeRequestsList() {
  const { t } = useTranslation();
  const lang = currentLang() === "ar" ? "ar" : "en";
  const q = useAdminPriceChangeRequests();

  if (q.isLoading) return <p className="text-sm">{t("common.loading")}</p>;
  if (q.isError) return <QueryError onRetry={() => q.refetch()} />;

  const rows = q.data ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold">{t("adminPriceChange.listTitle")}</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("adminPriceChange.listEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const service = row.service as { name_en?: string; name_ar?: string } | null;
            const profile = (row.provider as { profile?: { full_name?: string } } | null)?.profile;
            const name =
              lang === "ar"
                ? (service?.name_ar ?? service?.name_en)
                : (service?.name_en ?? service?.name_ar);
            const kindLabel =
              lang === "ar"
                ? adminPriceChangeKindLabelAr(row.kind)
                : row.kind === "online"
                  ? t("adminPriceChange.kindOnline")
                  : t("adminPriceChange.kindInPerson");
            return (
              <li key={`${row.id}-${row.kind}`}>
                <Link
                  to="/admin/price-change/$id"
                  params={{ id: row.id }}
                  search={{ kind: row.kind }}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 hover:border-brand"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{name}</p>
                    <p className="truncate text-xs text-muted-foreground">{profile?.full_name}</p>
                    <p className="text-xs font-semibold text-muted-foreground">{kindLabel}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {row.liveAmount ?? "—"} → {row.pendingAmount} EGP
                    </p>
                  </div>
                  <span className="text-xs font-bold text-brand">
                    {t("adminPriceChange.openReview")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}