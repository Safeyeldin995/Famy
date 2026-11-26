import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { AdminCustomerCard } from "@/components/admin/AdminCustomerCard";
import { adminDate } from "@/components/admin/adminPresentation";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminCustomers, type AdminCustomerFilter } from "@/lib/db/admin-queries";
import { formatEGP } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function CustomerManagement() {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<AdminCustomerFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const debouncedQuery = useDebounced(query, 300);
  const q = useAdminCustomers(filter, debouncedQuery, page);

  useEffect(() => {
    setPage(0);
  }, [debouncedQuery, filter]);

  const rows = (q.data?.items ?? []) as any[];
  const total = q.data?.total ?? 0;
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <AdminPage title={t("admin.customers.title")} subtitle={t("admin.customers.subtitle")}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <AdminSearchBar
          value={query}
          onChange={setQuery}
          placeholder={t("admin.customers.searchPlaceholder")}
          className="flex-1"
        />
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
        <div className="grid gap-3 sm:hidden">
          {rows.map((c: any) => (
            <AdminCustomerCard key={c.id} customer={c} />
          ))}
        </div>
        <AdminTable className="hidden sm:block">
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
                  <div className="font-semibold text-foreground">
                    {c.full_name || t("admin.provider.unnamed")}
                  </div>
                  <div dir="ltr" className="text-xs text-muted-foreground">
                    {c.phone}
                  </div>
                </AdminTableTd>
                <AdminTableTd className="text-xs text-muted-foreground">
                  {adminDate(c.created_at, i18n.language, false)}
                </AdminTableTd>
                <AdminTableTd className="tabular-nums">{c.totalBookings}</AdminTableTd>
                <AdminTableTd className="tabular-nums">{c.completedBookings}</AdminTableTd>
                <AdminTableTd className="tabular-nums">{c.cancelledBookings}</AdminTableTd>
                <AdminTableTd className="font-semibold tabular-nums">
                  {formatEGP(c.totalSpent)}
                </AdminTableTd>
                <AdminTableTd>
                  <AdminStatusBadge tone={c.is_suspended ? "danger" : "success"}>
                    {c.is_suspended ? t("admin.providers.suspended") : t("admin.customers.active")}
                  </AdminStatusBadge>
                </AdminTableTd>
                <AdminTableTd>
                  <Link
                    to={"/admin/customer/$id" as "/admin/customer/$id"}
                    params={{ id: c.id }}
                    className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-brand"
                  >
                    {t("admin.customers.view")} <ChevronRight className="rtl-flip h-3.5 w-3.5" />
                  </Link>
                </AdminTableTd>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminTable>
        {total > pageSize ? (
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {t("admin.auditLog.pageOf", { page: page + 1, totalPages, total })}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="focus-ring inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40"
              >
                <ChevronLeft className="rtl-flip h-3.5 w-3.5" /> {t("admin.auditLog.prev")}
              </button>
              <button
                type="button"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="focus-ring inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40"
              >
                {t("admin.auditLog.next")} <ChevronRight className="rtl-flip h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </AdminQueryState>
    </AdminPage>
  );
}