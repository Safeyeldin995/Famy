import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { usePendingProviders, useAdminDashboardKpis } from "@/lib/db/admin-queries";
import { formatEGP } from "@/lib/utils";
import { ShieldCheck, ClipboardList, Wallet, Clock, Users, UserCheck } from "lucide-react";
import { AdminQueryError } from "@/components/admin/AdminQueryError";

export const Route = createFileRoute("/admin/")({ component: AdminHome });

function KpiCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Icon className={`h-4 w-4 ${tone}`} />
        {label}
      </div>
      <p className="mt-2 text-2xl font-extrabold">{value}</p>
    </div>
  );
}

function useTotalBookingsCount() {
  return useQuery({
    queryKey: ['admin', 'bookings-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('bookings').select('id', { count: 'exact', head: true });
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
    <div className="px-5 py-5 space-y-5">
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("admin.index.overview")}</h1>
        {kpis.isLoading ? (
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />)}
          </div>
        ) : kpis.isError ? (
          <div className="mt-2"><AdminQueryError message={t("admin.index.kpiError")} error={kpis.error} onRetry={() => kpis.refetch()} /></div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard icon={Wallet} label={t("admin.index.revenue")} value={formatEGP(kpis.data!.revenue)} tone="text-navy" />
            <KpiCard icon={ClipboardList} label={t("admin.index.activeBookings")} value={String(kpis.data!.activeBookings)} tone="text-coral" />
            <KpiCard icon={Clock} label={t("admin.index.pendingBookings")} value={String(kpis.data!.pendingBookings)} tone="text-amber-600" />
            <KpiCard icon={UserCheck} label={t("admin.index.activeProviders")} value={String(kpis.data!.activeProviders)} tone="text-navy" />
            <KpiCard icon={Users} label={t("admin.index.activeCustomers")} value={String(kpis.data!.activeCustomers)} tone="text-coral" />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Link to="/admin/providers" className="focus-ring flex items-center justify-between rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-coral" />
            <div>
              <p className="text-sm font-bold">{t("admin.index.pendingProviders")}</p>
              <p className="text-xs text-muted-foreground">{t("admin.index.pendingProvidersBody")}</p>
            </div>
          </div>
          <span className="rounded-full bg-coral/10 px-2 py-0.5 text-xs font-bold text-coral">
            {pending.data?.length ?? 0}
          </span>
        </Link>
        <Link to="/admin/bookings" className="focus-ring flex items-center justify-between rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-5 w-5 text-navy" />
            <div>
              <p className="text-sm font-bold">{t("admin.layout.nav.bookings")}</p>
              <p className="text-xs text-muted-foreground">{t("admin.index.bookingsBody")}</p>
            </div>
          </div>
          <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-bold text-navy">
            {bookingsCount.data ?? 0}
          </span>
        </Link>
      </div>
    </div>
  );
}
