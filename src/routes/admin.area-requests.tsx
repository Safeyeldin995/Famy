import { QueryError } from "@/components/famio/QueryError";
import { useAdminAreaRequests } from "@/lib/db/admin-area-request-queries";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/area-requests")({
  component: AdminAreaRequests,
});

function AdminAreaRequests() {
  const { t, i18n } = useTranslation();
  const q = useAdminAreaRequests();

  if (q.isLoading) return <p className="text-sm">{t("common.loading")}</p>;
  if (q.isError) return <QueryError onRetry={() => q.refetch()} />;

  const clusters = q.data ?? [];
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language === "ar" ? "ar-EG" : "en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "Africa/Cairo",
    });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold">{t("adminAreaRequests.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("adminAreaRequests.subtitle")}</p>
      </div>
      {clusters.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("adminAreaRequests.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {clusters.map((c) => (
            <li
              key={c.key}
              className="flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold">
                  {t("adminAreaRequests.customers", { count: c.customers })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("adminAreaRequests.requestsLatest", {
                    count: c.requests,
                    date: date(c.latestAt),
                  })}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                  {c.lat.toFixed(4)}, {c.lng.toFixed(4)}
                </p>
              </div>
              <a
                href={`https://www.google.com/maps?q=${c.lat},${c.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-brand"
              >
                {t("adminAreaRequests.openMap")}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
