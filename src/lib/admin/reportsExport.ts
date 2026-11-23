import { downloadCsv } from "@/lib/admin/csvExport";
import type { AdminReport } from "@/lib/db/admin-daily-ops-queries";

type ColumnLabels = Record<string, string>;

export function downloadReportsCsv(report: AdminReport, columns: ColumnLabels, filename: string) {
  const keys = [
    "bucket_start",
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
  const header = keys.map((k) => columns[k] ?? k);
  const rows = report.buckets.map((b) => keys.map((k) => String((b as Record<string, unknown>)[k] ?? "")));
  const totalsRow = keys.map((k) =>
    k === "bucket_start"
      ? columns.totals ?? "Totals"
      : String((report.totals as Record<string, unknown>)[k] ?? ""),
  );
  downloadCsv(filename, [header, ...rows, [], totalsRow]);
}