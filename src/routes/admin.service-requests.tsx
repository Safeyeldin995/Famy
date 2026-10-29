import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { QueryError } from "@/components/famio/QueryError";
import { useAdminNewServiceRequests } from "@/lib/db/admin-service-request-queries";
import { currentLang } from "@/lib/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/service-requests")({
  component: AdminServiceRequestsList,
});

function AdminServiceRequestsList() {
  const { t } = useTranslation();
  const lang = currentLang() === "ar" ? "ar" : "en";
  const q = useAdminNewServiceRequests();

  if (q.isLoading) return <p className="text-sm">{t("common.loading")}</p>;
  if (q.isError) return <QueryError onRetry={() => q.refetch()} />;

  const rows = q.data ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold">{t("adminServiceRequest.listTitle")}</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("adminServiceRequest.listEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const service = row.service as { name_en?: string; name_ar?: string } | null;
            const profile = (row.provider as { profile?: { full_name?: string } } | null)?.profile;
            const name =
              lang === "ar"
                ? service?.name_ar ?? service?.name_en
                : service?.name_en ?? service?.name_ar;
            return (
              <li key={row.id}>
                <Link
                  to="/admin/service-request/$id"
                  params={{ id: row.id }}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 hover:border-brand"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{name}</p>
                    <p className="truncate text-xs text-muted-foreground">{profile?.full_name}</p>
                  </div>
                  <span className="text-xs font-bold text-brand">{t("adminServiceRequest.openReview")}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
