import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileSpreadsheet } from "lucide-react";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import {
  statementRangeForPreset,
  financeRangeForDays,
  type StatementPreset,
} from "@/lib/settlement/cairoSettlementWeek";
import { useAdminProviderStatement } from "@/lib/db/admin-daily-ops-queries";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { formatEGP } from "@/lib/utils";
import { adminControl, adminScreen, bookingCode, operationDate } from "@/components/admin/operations";
import { useLang } from "@/components/famio/LanguageToggle";
import { downloadStatementCsv } from "@/lib/admin/statementExport";
import { sanitizeDownloadFilename } from "@/lib/admin/csvExport";

export function AdminProviderStatementPanel({
  providerId,
  providerName,
}: {
  providerId: string;
  providerName: string;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<StatementPreset>("thisMonth");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [anchor, setAnchor] = useState(() => new Date().toISOString());

  const range = useMemo(() => {
    if (preset === "custom") return financeRangeForDays(fromDay, toDay);
    return statementRangeForPreset(preset, new Date(anchor));
  }, [preset, fromDay, toDay, anchor]);

  const q = useAdminProviderStatement(providerId, range?.from, range?.to);

  const labels = useMemo(
    () => ({
      title: t("admin.statement.exportTitle"),
      provider: t("admin.statement.provider"),
      period: t("admin.statement.period"),
      opening: t("admin.statement.opening"),
      periodNet: t("admin.statement.periodNet"),
      closing: t("admin.statement.closing"),
      columns: {
        date: t("admin.statement.colDate"),
        kind: t("admin.statement.colKind"),
        booking: t("admin.statement.colBooking"),
        price: t("admin.statement.colPrice"),
        commission: t("admin.statement.colCommission"),
        share: t("admin.statement.colShare"),
        debit: t("admin.statement.colDebit"),
        credit: t("admin.statement.colCredit"),
      },
      kindLabels: {
        online_provider_share: t("admin.statement.kind.online_provider_share"),
        cash_collected_platform_share: t("admin.statement.kind.cash_collected_platform_share"),
        payout_sent: t("admin.statement.kind.payout_sent"),
        debt_payment_received: t("admin.statement.kind.debt_payment_received"),
        adjustment: t("admin.statement.kind.adjustment"),
        cancellation_fee_provider_share: t("admin.statement.kind.cancellation_fee_provider_share"),
        carried_fee_collected: t("admin.statement.kind.carried_fee_collected"),
      },
    }),
    [t],
  );

  const exportBase = sanitizeDownloadFilename(`${providerName}_statement`);

  if (!open) {
    return (
      <button type="button" className={adminControl} onClick={() => setOpen(true)}>
        {t("admin.statement.open")}
      </button>
    );
  }

  return (
    <section className={`${adminScreen} rounded-2xl border border-border bg-surface p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-extrabold">{t("admin.statement.title")}</h2>
        <button type="button" className={adminControl} onClick={() => setOpen(false)}>
          {t("common.close")}
        </button>
      </div>
      <p className="text-sm text-muted-foreground">{t("admin.statement.hint")}</p>
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
      {q.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : q.isError ? (
        <AdminQueryError message={t("admin.statement.loadError")} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <>
          <StatementTotals data={q.data} lang={lang} t={t} />
          <div className="flex flex-wrap gap-2">
            <Link
              to="/admin/provider/$id/statement/print"
              params={{ id: providerId }}
              search={{ from: range!.from, to: range!.to }}
              target="_blank"
              rel="noopener"
              className={`${adminControl} inline-flex items-center gap-2 ${!q.data.rows.length ? "pointer-events-none opacity-50" : ""}`}
              aria-disabled={!q.data.rows.length}
              tabIndex={!q.data.rows.length ? -1 : undefined}
            >
              <Download className="h-4 w-4" />
              {t("admin.statement.downloadPdf")}
            </Link>
            <button
              type="button"
              className={`${adminControl} inline-flex items-center gap-2`}
              disabled={!q.data.rows.length}
              onClick={() => downloadStatementCsv(q.data!, labels, `${exportBase}.csv`, lang)}
            >
              <FileSpreadsheet className="h-4 w-4" />
              {t("admin.statement.downloadExcel")}
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-muted/50 text-start">
                <tr>
                  <th className="p-2">{labels.columns.date}</th>
                  <th className="p-2">{labels.columns.kind}</th>
                  <th className="p-2">{labels.columns.booking}</th>
                  <th className="p-2">{labels.columns.debit}</th>
                  <th className="p-2">{labels.columns.credit}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="p-2 whitespace-nowrap">
                      {operationDate(row.created_at, lang)}
                    </td>
                    <td className="p-2">
                      {(labels.kindLabels as Record<string, string>)[row.kind] ?? row.kind}
                    </td>
                    <td className="p-2">
                      {row.booking_id ? <bdi dir="ltr">{bookingCode(row.booking_id)}</bdi> : "—"}
                    </td>
                    <td className="p-2 tabular-nums">
                      {row.direction === "debit" ? formatEGP(row.amount) : "—"}
                    </td>
                    <td className="p-2 tabular-nums">
                      {row.direction === "credit" ? formatEGP(row.amount) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

function StatementTotals({
  data,
  lang,
  t,
}: {
  data: { opening_balance: number; closing_balance: number; rows: unknown[] };
  lang: string;
  t: (key: string, opts?: { count?: string }) => string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border p-3">
        <p className="text-xs text-muted-foreground">{t("admin.statement.opening")}</p>
        <p className="text-lg font-extrabold tabular-nums">{formatEGP(data.opening_balance)}</p>
      </div>
      <div className="rounded-xl border p-3">
        <p className="text-xs text-muted-foreground">{t("admin.statement.closing")}</p>
        <p className="text-lg font-extrabold tabular-nums">{formatEGP(data.closing_balance)}</p>
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        {t("admin.statement.rows", { count: data.rows.length.toLocaleString("en-US") })}
      </p>
    </div>
  );
}
