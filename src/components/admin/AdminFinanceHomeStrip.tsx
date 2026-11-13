import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { useTranslation } from "react-i18next";
import { useAdminFinanceProviders, useAdminFinanceSummary, useSettlementClosedPeriod } from "@/lib/db/admin-finance-queries";
import { defaultFinanceRangeFromPeriod } from "@/lib/settlement/cairoSettlementWeek";
import { AdminQueryState } from "@/components/admin";
import { formatEGP } from "@/lib/utils";

export function AdminFinanceHomeStrip() {
  const { t } = useTranslation();
  const period = useSettlementClosedPeriod();
  const range =
    period.data != null ? defaultFinanceRangeFromPeriod(period.data) : { from: "", to: "" };
  const fromIso = range.from ? new Date(range.from).toISOString() : undefined;
  const toIso = range.to ? new Date(range.to).toISOString() : undefined;
  const summary = useAdminFinanceSummary(fromIso, toIso);
  const providers = useAdminFinanceProviders();

  const atLimit = (providers.data ?? []).filter((row) => row.at_limit).length;
  const pendingCount = summary.data?.pending_settlement_count ?? 0;
  const pendingAmount = summary.data?.pending_settlement_amount ?? 0;

  return (
    <AdminQueryState
      isLoading={period.isLoading || summary.isLoading || providers.isLoading}
      isError={period.isError || summary.isError || providers.isError}
      error={period.error ?? summary.error ?? providers.error}
      onRetry={() => {
        void period.refetch();
        void summary.refetch();
        void providers.refetch();
      }}
      errorMessage={t("admin.finance.loadError")}
      skeletonCount={3}
    >
      {() => (
        <section
          className="grid gap-3 sm:grid-cols-3"
          aria-label={t("admin.finance.title")}
        >
          <Link
            to="/admin/finance"
            className="focus-ring flex min-h-16 flex-col justify-center gap-1 rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm hover:border-brand"
          >
            <span className="text-xs font-bold text-muted-foreground">
              {t("admin.finance.pendingSettlements")}
            </span>
            <span className="text-lg font-extrabold tabular-nums text-brand">
              {pendingCount.toLocaleString("en-US")}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              {formatEGP(pendingAmount)}
            </span>
          </Link>
          <Link
            to="/admin/finance"
            className="focus-ring flex min-h-16 flex-col justify-center gap-1 rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm hover:border-brand"
          >
            <span className="text-xs font-bold text-muted-foreground">
              {t("adminWorkQueue.providers_at_cash_limit")}
            </span>
            <span
              className={`text-lg font-extrabold tabular-nums ${atLimit > 0 ? "text-destructive" : "text-muted-foreground"}`}
            >
              {atLimit.toLocaleString("en-US")}
            </span>
          </Link>
          <Link
            to="/admin/finance"
            className="focus-ring flex min-h-16 items-center justify-center rounded-2xl border border-dashed border-border bg-surface-2/40 px-4 py-3 text-sm font-bold text-brand hover:border-brand"
          >
            {t("admin.finance.openDashboard")}
          </Link>
        </section>
      )}
    </AdminQueryState>
  );
}
