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
import { adminDate } from "@/components/admin/adminPresentation";
import { formatEGP } from "@/lib/utils";
import { useLang } from "@/components/famio/LanguageToggle";
import { downloadReportsCsv } from "@/lib/admin/reportsExport";

export const Route = createFileRoute("/admin/reports/")({ component: AdminReportsPage });

type ReportGroup = "day" | "week" | "month";

const METRIC_KEYS = [
  "bookings_created",
  "bookings_completed",
  "bookings_cancelled",
  "revenue",
  "platform_commission",
  "cash_collected",
  "card_received",
  "instapay_received",
  "refunds_total",
  "cancellation_fees",
] as const;

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

  const formatBucket = (iso: string) => adminDate(iso, lang, false);

  const formatMetric = (key: (typeof METRIC_KEYS)[number], value: number) => {
    if (
      key === "bookings_created" ||
      key === "bookings_completed" ||
      key === "bookings_cancelled"
    ) {
      return value.toLocaleString("en-US");
    }
    return formatEGP(value);
  };

  return (
    <div className={adminScreen}>
      <h1 className="text-xl font-bold">{t("admin.reports.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("admin.reports.subtitle")}</p>
      {q.data?.date_basis ? (
        <ul className="space-y-1 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {METRIC_KEYS.map((key) => {
            const basis = q.data!.date_basis[key];
            if (!basis) return null;
            return (
              <li key={key}>
                <strong className="text-foreground">{columnLabels[key]}:</strong>{" "}
                {t("admin.reports.basisLine", {
                  basis: t(`admin.reports.dateBasis.${basis.basis}`, { defaultValue: basis.basis }),
                  timestamp: adminDate(basis.timestamp, lang),
                })}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {t("admin.reports.dateBasisNote")}
        </p>
      )}
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
          onClick={() => q.data && downloadReportsCsv(q.data, columnLabels, "famy_reports.csv")}
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
          <table className="w-full min-w-[72rem] text-sm">
            <thead className="bg-muted/50 text-start">
              <tr>
                <th className="p-2">{columnLabels.bucket_start}</th>
                {METRIC_KEYS.map((key) => (
                  <th key={key} className="p-2">
                    {columnLabels[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.buckets.map((row) => (
                <tr key={row.bucket_start} className="border-t">
                  <td className="p-2 whitespace-nowrap">{formatBucket(row.bucket_start)}</td>
                  {METRIC_KEYS.map((key) => (
                    <td key={key} className="p-2 tabular-nums">
                      {formatMetric(key, Number(row[key] ?? 0))}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t bg-muted/40 font-bold">
                <td className="p-2">{columnLabels.totals}</td>
                {METRIC_KEYS.map((key) => (
                  <td key={key} className="p-2 tabular-nums">
                    {formatMetric(key, Number(q.data!.totals[key] ?? 0))}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
