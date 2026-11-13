import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import {
  AdminEmptyState,
  AdminQueryError,
  AdminQueryState,
  AdminTable,
  AdminTableBody,
  AdminTableHead,
  AdminTableRow,
  AdminTableTd,
  AdminTableTh,
} from "@/components/admin";
import { adminDate } from "@/components/admin/adminPresentation";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAdminFinanceProviders,
  useAdminFinanceSummary,
  useSettlementClosedPeriod,
} from "@/lib/db/admin-finance-queries";
import { defaultFinanceRangeFromPeriod } from "@/lib/settlement/cairoSettlementWeek";
import { settlementStatusLabel } from "@/lib/settlement/settlementPresentation";
import { formatEGP } from "@/lib/utils";
import { useLang } from "@/components/famio/LanguageToggle";

export const Route = createFileRoute("/admin/finance")({ component: AdminFinancePage });

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

function AdminFinancePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const periodQ = useSettlementClosedPeriod();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => {
    if (periodQ.data && !from) {
      const range = defaultFinanceRangeFromPeriod(periodQ.data);
      setFrom(range.from);
      setTo(range.to);
    }
  }, [periodQ.data, from]);
  const fromIso = from ? new Date(from).toISOString() : undefined;
  const toIso = to ? new Date(to).toISOString() : undefined;
  const summaryQ = useAdminFinanceSummary(fromIso, toIso);
  const providersQ = useAdminFinanceProviders();

  const methodLabels: Record<string, string> = {
    cash: t("admin.finance.methodCash"),
    gateway: t("admin.finance.methodGateway"),
    transfer: t("admin.finance.methodTransfer"),
    unknown: t("admin.finance.methodOther"),
  };

  const rows = providersQ.data ?? [];
  const methodEntries = summaryQ.data ? Object.entries(summaryQ.data.totals_by_method) : [];

  return (
    <main className="space-y-5 px-4 py-5 sm:px-6">
      <header>
        <h1 className="text-xl font-extrabold">{t("admin.finance.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("admin.finance.subtitle")}</p>
      </header>

      <section className="flex flex-wrap gap-3 rounded-2xl border border-border bg-surface p-4">
        <label className="block text-sm">
          <span className="font-semibold">{t("admin.finance.from")}</span>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block min-h-11 rounded-xl border border-border bg-background px-3"
          />
        </label>
        <label className="block text-sm">
          <span className="font-semibold">{t("admin.finance.to")}</span>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block min-h-11 rounded-xl border border-border bg-background px-3"
          />
        </label>
      </section>

      <AdminQueryState
        isLoading={summaryQ.isLoading}
        isError={summaryQ.isError}
        error={summaryQ.error}
        onRetry={() => summaryQ.refetch()}
        errorMessage={t("admin.finance.loadError")}
        skeletonCount={6}
      >
        {() =>
          summaryQ.data ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {methodEntries.map(([key, amount]) => (
                <SummaryCard key={key} label={methodLabels[key] ?? key} value={formatEGP(amount)} />
              ))}
              <SummaryCard
                label={t("admin.finance.platformShare")}
                value={formatEGP(summaryQ.data.platform_share)}
              />
              <SummaryCard
                label={t("admin.finance.owedToProviders")}
                value={formatEGP(summaryQ.data.owed_to_providers)}
              />
              <SummaryCard
                label={t("admin.finance.owedByProviders")}
                value={formatEGP(summaryQ.data.owed_by_providers)}
              />
              <SummaryCard
                label={t("admin.finance.pendingSettlements")}
                value={`${summaryQ.data.pending_settlement_count.toLocaleString("en-US")} · ${formatEGP(summaryQ.data.pending_settlement_amount)}`}
              />
            </div>
          ) : (
            <AdminEmptyState title={t("admin.finance.emptySummary")} />
          )
        }
      </AdminQueryState>

      <section>
        <h2 className="mb-3 text-sm font-extrabold text-foreground">{t("admin.finance.providersTitle")}</h2>
        {providersQ.isError ? (
          <AdminQueryError
            message={t("admin.providers.loadError")}
            error={providersQ.error}
            onRetry={() => providersQ.refetch()}
          />
        ) : providersQ.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <AdminEmptyState title={t("admin.finance.providersEmpty")} />
        ) : (
          <AdminTable>
            <AdminTableHead>
              <AdminTableTh>{t("admin.finance.colProvider")}</AdminTableTh>
              <AdminTableTh>{t("admin.finance.colNet")}</AdminTableTh>
              <AdminTableTh>{t("admin.finance.colDirection")}</AdminTableTh>
              <AdminTableTh>{t("admin.finance.colCashHeld")}</AdminTableTh>
              <AdminTableTh>{t("admin.finance.colLimit")}</AdminTableTh>
              <AdminTableTh>{t("admin.finance.colLastSettlement")}</AdminTableTh>
              <AdminTableTh />
            </AdminTableHead>
            <AdminTableBody>
              {rows.map((row) => {
                const directionLabel =
                  row.net > 0
                    ? t("admin.settlement.directionFamyPays")
                    : row.net < 0
                      ? t("admin.settlement.directionProviderPays")
                      : null;
                return (
                  <AdminTableRow key={row.provider_id}>
                    <AdminTableTd className="font-semibold">{row.full_name ?? "—"}</AdminTableTd>
                    <AdminTableTd className="tabular-nums font-bold">{formatEGP(row.net)}</AdminTableTd>
                    <AdminTableTd>
                      {directionLabel ? (
                        <span className="rounded-lg bg-surface-2 px-2 py-0.5 text-xs font-bold">
                          {directionLabel}
                        </span>
                      ) : (
                        "—"
                      )}
                    </AdminTableTd>
                    <AdminTableTd className="tabular-nums">{formatEGP(row.cash_held)}</AdminTableTd>
                    <AdminTableTd>
                      {row.at_limit ? (
                        <span className="rounded-lg bg-destructive/15 px-2 py-0.5 text-xs font-bold text-destructive">
                          {t("admin.finance.atLimit")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </AdminTableTd>
                    <AdminTableTd className="text-xs text-muted-foreground">
                      {row.last_settlement_at
                        ? `${adminDate(row.last_settlement_at, lang, false)} · ${settlementStatusLabel(row.last_settlement_status ?? "", t)}`
                        : "—"}
                    </AdminTableTd>
                    <AdminTableTd>
                      <Link
                        to="/admin/provider/$id"
                        params={{ id: row.provider_id }}
                        className="focus-ring text-xs font-bold text-brand"
                      >
                        {t("admin.finance.openProviderFile")}
                      </Link>
                    </AdminTableTd>
                  </AdminTableRow>
                );
              })}
            </AdminTableBody>
          </AdminTable>
        )}
      </section>
    </main>
  );
}
