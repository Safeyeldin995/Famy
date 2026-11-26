import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminQueryError } from "@/components/admin/AdminQueryError";

export const Route = createFileRoute("/admin/documents-expiring")({ component: ExpiringDocuments });

type Row = {
  document_id: string;
  provider_id: string;
  document_type: string;
  expires_at: string;
  full_name: string | null;
};

function ExpiringDocuments() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["admin", "documents-expiring"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as (n: string, a: object) => ReturnType<typeof supabase.rpc>)(
        "admin_expiring_provider_documents",
        { p_within_days: 30 },
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  return (
    <div className="space-y-4 px-5 py-5">
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          {t("admin.documentsExpiring.title")}
        </h1>
        <p className="text-xs text-muted-foreground">{t("admin.documentsExpiring.subtitle")}</p>
      </div>
      {q.isLoading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
      ) : q.isError ? (
        <AdminQueryError message={t("admin.documentsExpiring.loadError")} error={q.error} onRetry={() => q.refetch()} />
      ) : !(q.data ?? []).length ? (
        <p className="text-sm text-muted-foreground">{t("admin.documentsExpiring.empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border bg-surface">
          {(q.data ?? []).map((row) => (
            <li key={row.document_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="text-sm font-bold">{row.full_name || row.provider_id}</p>
                <p className="text-xs text-muted-foreground">
                  {t("admin.documentsExpiring.type", { type: row.document_type })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold tabular-nums" dir="ltr">
                  {new Date(row.expires_at).toLocaleDateString("en-GB", { timeZone: "Africa/Cairo" })}
                </span>
                <Link
                  to="/admin/provider/$id"
                  params={{ id: row.provider_id }}
                  className="focus-ring min-h-11 rounded-xl bg-brand px-3 text-xs font-bold text-brand-foreground"
                >
                  {t("admin.documentsExpiring.review")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}