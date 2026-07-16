import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminCustomers, type AdminCustomerFilter } from "@/lib/db/admin-queries";
import { formatEGP } from "@/lib/utils";
import { Search, ChevronRight } from "lucide-react";
import { AdminQueryError } from "@/components/admin/AdminQueryError";

export const Route = createFileRoute("/admin/customers")({ component: CustomerManagement });

const FILTER_KEYS: { key: AdminCustomerFilter; labelKey: string }[] = [
  { key: "all", labelKey: "admin.providers.filterAll" },
  { key: "active", labelKey: "admin.customers.filterActive" },
  { key: "suspended", labelKey: "admin.providers.filterSuspended" },
  { key: "has_bookings", labelKey: "admin.customers.filterHasBookings" },
  { key: "no_bookings", labelKey: "admin.customers.filterNoBookings" },
];

function CustomerManagement() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<AdminCustomerFilter>("all");
  const [query, setQuery] = useState("");
  const q = useAdminCustomers(filter);

  const rows = useMemo(() => {
    const all = q.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((c: any) => {
      const name = String(c.full_name ?? "").toLowerCase();
      const phone = String(c.phone ?? "").toLowerCase();
      const id = String(c.id ?? "").toLowerCase();
      return name.includes(needle) || phone.includes(needle) || id.includes(needle);
    });
  }, [q.data, query]);

  return (
    <div className="px-5 py-5 space-y-4">
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("admin.customers.title")}</h1>
        <p className="text-xs text-muted-foreground">{t("admin.customers.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.customers.searchPlaceholder")}
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
          {FILTER_KEYS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`focus-ring rounded-lg px-3 py-1.5 text-xs font-bold ${filter === f.key ? "bg-navy text-navy-foreground" : "text-muted-foreground"}`}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : q.isError ? (
        <AdminQueryError message={t("admin.customers.loadError")} error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.customers.noResults")}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-surface shadow-card">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-border/60 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">{t("admin.customers.customer")}</th>
                <th className="px-4 py-3 text-start">{t("admin.customers.registered")}</th>
                <th className="px-4 py-3 text-start">{t("admin.customers.totalBookings")}</th>
                <th className="px-4 py-3 text-start">{t("admin.customers.completed")}</th>
                <th className="px-4 py-3 text-start">{t("admin.customers.cancelled")}</th>
                <th className="px-4 py-3 text-start">{t("admin.customers.totalSpent")}</th>
                <th className="px-4 py-3 text-start">{t("admin.customers.status")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((c: any) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{c.full_name || t("admin.provider.unnamed")}</div>
                    <div dir="ltr" className="text-xs text-muted-foreground">{c.phone}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{c.totalBookings}</td>
                  <td className="px-4 py-3">{c.completedBookings}</td>
                  <td className="px-4 py-3">{c.cancelledBookings}</td>
                  <td className="px-4 py-3 font-semibold">{formatEGP(c.totalSpent)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${c.is_suspended ? "bg-coral/10 text-coral" : "bg-mint/20 text-success"}`}>
                      {c.is_suspended ? t("admin.providers.suspended") : t("admin.customers.active")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link to="/admin/customer/$id" params={{ id: c.id }} className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-navy">
                      {t("admin.customers.view")} <ChevronRight className="rtl-flip h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
