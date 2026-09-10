import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { usePendingProviders, useAdminDashboardKpis } from "@/lib/db/admin-queries";
import { formatEGP } from "@/lib/utils";
import { ShieldCheck, ClipboardList, Wallet, Clock, Users, UserCheck } from "lucide-react";
import { AdminPage, AdminMetricCard, AdminCard, AdminQueryState } from "@/components/admin";

export const Route = createFileRoute("/admin/")({ component: AdminHome });

function useTotalBookingsCount() {
  return useQuery({
    queryKey: ["admin", "bookings-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });
}

function AdminHome() {
  const { t } = useTranslation();
  const pending = usePendingProviders();
  const bookingsCount = useTotalBookingsCount();
  const kpis = useAdminDashboardKpis();

  return (
    <AdminPage
      title={t("admin.index.overview")}
      subtitle={t("admin.index.subtitle", "Operational snapshot for today")}
    >
      <AdminQueryState
        isLoading={kpis.isLoading}
        isError={kpis.isError}
        error={kpis.error}
        onRetry={() => kpis.refetch()}
        errorMessage={t("admin.index.kpiError")}
        skeletonCount={5}
      >
        {() => {
          const data = kpis.data;
          if (!data) return null;
          return (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <AdminMetricCard
                icon={Wallet}
                label={t("admin.index.revenue")}
                value={formatEGP(data.revenue)}
                tone="brand"
              />
              <AdminMetricCard
                icon={ClipboardList}
                label={t("admin.index.activeBookings")}
                value={String(data.activeBookings)}
                tone="info"
              />
              <AdminMetricCard
                icon={Clock}
                label={t("admin.index.pendingBookings")}
                value={String(data.pendingBookings)}
                tone="warning"
              />
              <AdminMetricCard
                icon={UserCheck}
                label={t("admin.index.activeProviders")}
                value={String(data.activeProviders)}
                tone="success"
              />
              <AdminMetricCard
                icon={Users}
                label={t("admin.index.activeCustomers")}
                value={String(data.activeCustomers)}
                tone="brand"
              />
            </div>
          );
        }}
      </AdminQueryState>

      <div className="grid gap-3 sm:grid-cols-2">
        <AdminQueryState
          isLoading={pending.isLoading}
          isError={pending.isError}
          error={pending.error}
          onRetry={() => pending.refetch()}
          errorMessage={t("admin.providers.loadError")}
        >
          <AdminMetricCard
            icon={ShieldCheck}
            label={t("admin.index.pendingProviders")}
            value={String(pending.data?.length ?? 0)}
            hint={t("admin.index.pendingProvidersBody")}
            tone="warning"
            to="/admin/providers"
          />
        </AdminQueryState>

        <AdminQueryState
          isLoading={bookingsCount.isLoading}
          isError={bookingsCount.isError}
          error={bookingsCount.error}
          onRetry={() => bookingsCount.refetch()}
          errorMessage={t("admin.bookings.loadError")}
        >
          <AdminMetricCard
            icon={ClipboardList}
            label={t("admin.layout.nav.bookings")}
            value={String(bookingsCount.data ?? 0)}
            hint={t("admin.index.bookingsBody")}
            tone="brand"
            to="/admin/bookings"
          />
        </AdminQueryState>
      </div>

      <AdminCard className="text-sm font-medium text-muted-foreground">
        {t(
          "admin.index.hint",
          "Use the sidebar to review providers, bookings, payments, and configuration. All actions are audited.",
        )}
      </AdminCard>
    </AdminPage>
  );
}
