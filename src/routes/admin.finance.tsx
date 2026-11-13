import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAdminFinanceProviders,
  useAdminFinanceSummary,
  useSettlementClosedPeriod,
} from "@/lib/db/admin-finance-queries";
import { defaultFinanceRangeFromPeriod } from "@/lib/settlement/cairoSettlementWeek";
import { formatEGP } from "@/lib/utils";

export const Route = createFileRoute("/admin/finance")({ component: AdminFinancePage });

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

function AdminFinancePage() {
  const { t } = useTranslation();
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

      {summaryQ.isError ? (
        <AdminQueryError
          message={t("admin.finance.loadError")}
          error={summaryQ.error}
          onRetry={() => summaryQ.refetch()}
        />
      ) : summaryQ.data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(summaryQ.data.totals_by_method).map(([key, amount]) => (
            <SummaryCard
              key={key}
              label={methodLabels[key] ?? key}
              value={formatEGP(amount)}
            />
          ))}
          <SummaryCard label={t("admin.finance.platformShare")} value={formatEGP(summaryQ.data.platform_share)} />
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
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      )}

      <section>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted-foreground">
          {t("admin.finance.providersTitle")}
        </h2>
        {providersQ.isError ? (
          <AdminQueryError
            message={t("admin.providers.loadError")}
            error={providersQ.error}
            onRetry={() => providersQ.refetch()}
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">{t("admin.finance.colProvider")}</th>
                  <th className="px-3 py-2">{t("admin.finance.colNet")}</th>
                  <th className="px-3 py-2">{t("admin.finance.colCashHeld")}</th>
                  <th className="px-3 py-2">{t("admin.finance.colLimit")}</th>
                  <th className="px-3 py-2">{t("admin.finance.colLastSettlement")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {(providersQ.data ?? []).map((row) => (
                  <tr key={row.provider_id} className="border-b border-border/50">
                    <td className="px-3 py-2 font-semibold">{row.full_name ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{formatEGP(row.net)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatEGP(row.cash_held)}</td>
                    <td className="px-3 py-2">
                      {row.at_limit ? (
                        <span className="rounded-lg bg-destructive/15 px-2 py-0.5 text-xs font-bold text-destructive">
                          {t("admin.finance.atLimit")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.last_settlement_at
                        ? `${new Date(row.last_settlement_at).toLocaleDateString()} · ${row.last_settlement_status ?? ""}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to="/admin/provider/$id"
                        params={{ id: row.provider_id }}
                        className="focus-ring text-xs font-bold text-brand"
                      >
                        {t("admin.finance.openProvider")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
