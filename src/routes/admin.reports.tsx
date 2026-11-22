import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileSpreadsheet } from "lucide-react";
import {
  financeRangeForDays,
  statementRangeForPreset,
  type StatementPreset,
} from "@/lib/settlement/cairoSettlementWeek";
import { useAdminReports } from "@/lib/db/admin-daily-ops-queries";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { adminControl, adminScreen } from "@/components/admin/operations";
import { formatEGP } from "@/lib/utils";
import { useLang } from "@/components/famio/LanguageToggle";
import { downloadReportsExcel } from "@/lib/admin/reportsExport";

export const Route = createFileRoute("/admin/reports")({ component: AdminReportsPage });

type ReportGroup = "day" | "week" | "month";

function AdminReportsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const [preset, setPreset] = useState<StatementPreset>("thisMonth");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [group, setGroup] = useState<ReportGroup>("day");
  const [anchor, setAnchor] = useState(() => new Date().toISOString());

  const range = useMemo(() => {
    if (preset === "custom") return financeRangeForDays(fromDay, toDay);
    return statementRangeForPreset(preset, new Date(anchor));
  }, [preset, fromDay, toDay, anchor]);

  const q = useAdminReports(range?.from, range?.to, group);

  const columnLabels = useMemo(
    () => ({
      bucket_start: t("admin.reports.colPeriod"),
      bookings_created: t("admin.reports.colCreated"),
      bookings_completed: t("admin.reports.colCompleted"),
      bookings_cancelled: t("admin.reports.colCancelled"),
      revenue: t("admin.reports.colRevenue"),
      platform_commission: t("admin.reports.colCommission"),
      cash_collected: t("admin.reports.colCash"),
      card_received: t("admin.reports.colCard"),
      instapay_received: t("admin.reports.colInstapay"),
      refunds_total: t("admin.reports.colRefunds"),
      cancellation_fees: t("admin.reports.colFees"),
      totals: t("admin.reports.totals"),
    }),
    [t],
  );

  const formatBucket = (iso: string) =>
    new Date(iso).toLocaleDateString(lang, { timeZone: "Africa/Cairo" });

  return (
    <div className={adminScreen}>
      <h1 className="text-xl font-bold">{t("admin.reports.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("admin.reports.subtitle")}</p>
      <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        {t("admin.reports.dateBasisNote")}
      </p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["thisMonth", t("admin.statement.thisMonth")],
            ["lastMonth", t("admin.statement.lastMonth")],
            ["custom", t("admin.statement.custom")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`${adminControl} ${preset === key ? "bg-brand text-brand-foreground" : ""}`}
            onClick={() => {
              setPreset(key);
              setAnchor(new Date().toISOString());
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {preset === "custom" ? (
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            value={fromDay}
            onChange={(e) => setFromDay(e.target.value)}
            className="min-h-11 rounded-xl border px-3"
            aria-label={t("admin.statement.from")}
          />
          <input
            type="date"
            value={toDay}
            onChange={(e) => setToDay(e.target.value)}
            className="min-h-11 rounded-xl border px-3"
            aria-label={t("admin.statement.to")}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {(["day", "week", "month"] as const).map((g) => (
          <button
            key={g}
            type="button"
            className={`${adminControl} ${group === g ? "bg-brand text-brand-foreground" : ""}`}
            onClick={() => setGroup(g)}
          >
            {t(`admin.reports.group.${g}`)}
          </button>
        ))}
        <button
          type="button"
          className={`${adminControl} inline-flex items-center gap-2`}
          disabled={!q.data?.buckets.length}
          onClick={() => q.data && downloadReportsExcel(q.data, columnLabels, "famy_reports.xlsx")}
        >
          <FileSpreadsheet className="h-4 w-4" />
          {t("admin.reports.exportExcel")}
        </button>
      </div>
      {q.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : q.isError ? (
        <AdminQueryError message={t("admin.reports.loadError")} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-muted/50 text-start">
              <tr>
                <th className="p-2">{columnLabels.bucket_start}</th>
                <th className="p-2">{columnLabels.bookings_created}</th>
                <th className="p-2">{columnLabels.bookings_completed}</th>
                <th className="p-2">{columnLabels.revenue}</th>
                <th className="p-2">{columnLabels.platform_commission}</th>
                <th className="p-2">{columnLabels.cash_collected}</th>
                <th className="p-2">{columnLabels.instapay_received}</th>
                <th className="p-2">{columnLabels.refunds_total}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.buckets.map((row) => (
                <tr key={row.bucket_start} className="border-t">
                  <td className="p-2 whitespace-nowrap">{formatBucket(row.bucket_start)}</td>
                  <td className="p-2 tabular-nums">{row.bookings_created}</td>
                  <td className="p-2 tabular-nums">{row.bookings_completed}</td>
                  <td className="p-2 tabular-nums">{formatEGP(row.revenue)}</td>
                  <td className="p-2 tabular-nums">{formatEGP(row.platform_commission)}</td>
                  <td className="p-2 tabular-nums">{formatEGP(row.cash_collected)}</td>
                  <td className="p-2 tabular-nums">{formatEGP(row.instapay_received)}</td>
                  <td className="p-2 tabular-nums">{formatEGP(row.refunds_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}