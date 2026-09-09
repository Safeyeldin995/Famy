import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminCustomers, type AdminCustomerFilter } from "@/lib/db/admin-queries";
import { formatEGP } from "@/lib/utils";
import { adminPath } from "@/lib/preview/previewPath";
import { ChevronRight } from "lucide-react";
import {
  AdminPage,
  AdminSearchBar,
  AdminFilterPills,
  AdminQueryState,
  AdminTable,
  AdminTableHead,
  AdminTableTh,
  AdminTableBody,
  AdminTableRow,
  AdminTableTd,
  AdminStatusBadge,
} from "@/components/admin";

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
    <AdminPage title={t("admin.customers.title")} subtitle={t("admin.customers.subtitle")}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <AdminSearchBar value={query} onChange={setQuery} placeholder={t("admin.customers.searchPlaceholder")} className="flex-1" />
        <AdminFilterPills
          value={filter}
          onChange={setFilter}
          options={FILTER_KEYS.map((f) => ({ value: f.key, label: t(f.labelKey) }))}
        />
      </div>

      <AdminQueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        onRetry={() => q.refetch()}
        errorMessage={t("admin.customers.loadError")}
        isEmpty={rows.length === 0}
        emptyTitle={t("admin.customers.noResults")}
      >
        <AdminTable>
          <AdminTableHead>
            <AdminTableTh>{t("admin.customers.customer")}</AdminTableTh>
            <AdminTableTh>{t("admin.customers.registered")}</AdminTableTh>
            <AdminTableTh>{t("admin.customers.totalBookings")}</AdminTableTh>
            <AdminTableTh>{t("admin.customers.completed")}</AdminTableTh>
            <AdminTableTh>{t("admin.customers.cancelled")}</AdminTableTh>
            <AdminTableTh>{t("admin.customers.totalSpent")}</AdminTableTh>
            <AdminTableTh>{t("admin.customers.status")}</AdminTableTh>
            <AdminTableTh />
          </AdminTableHead>
          <AdminTableBody>
            {rows.map((c: any) => (
              <AdminTableRow key={c.id}>
                <AdminTableTd>
                  <div className="font-semibold text-foreground">{c.full_name || t("admin.provider.unnamed")}</div>
                  <div dir="ltr" className="text-xs text-muted-foreground">{c.phone}</div>
                </AdminTableTd>
                <AdminTableTd className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</AdminTableTd>
                <AdminTableTd className="tabular-nums">{c.totalBookings}</AdminTableTd>
                <AdminTableTd className="tabular-nums">{c.completedBookings}</AdminTableTd>
                <AdminTableTd className="tabular-nums">{c.cancelledBookings}</AdminTableTd>
                <AdminTableTd className="font-semibold tabular-nums">{formatEGP(c.totalSpent)}</AdminTableTd>
                <AdminTableTd>
                  <AdminStatusBadge tone={c.is_suspended ? "danger" : "success"}>
                    {c.is_suspended ? t("admin.providers.suspended") : t("admin.customers.active")}
                  </AdminStatusBadge>
                </AdminTableTd>
                <AdminTableTd>
                  <Link to={adminPath("/admin/customer/$id") as "/admin/customer/$id"} params={{ id: c.id }} className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-brand">
                    {t("admin.customers.view")} <ChevronRight className="rtl-flip h-3.5 w-3.5" />
                  </Link>
                </AdminTableTd>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminTable>
      </AdminQueryState>
    </AdminPage>
  );
}
