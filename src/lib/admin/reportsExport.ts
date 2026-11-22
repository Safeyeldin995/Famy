import * as XLSX from "xlsx";
import type { AdminReport } from "@/lib/db/admin-daily-ops-queries";

type ColumnLabels = Record<string, string>;

export function downloadReportsExcel(report: AdminReport, columns: ColumnLabels, filename: string) {
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
  const rows = report.buckets.map((b) => keys.map((k) => (b as Record<string, unknown>)[k] ?? ""));
  const totalsRow = keys.map((k) =>
    k === "bucket_start" ? columns.totals ?? "Totals" : (report.totals as Record<string, unknown>)[k] ?? "",
  );
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows, [], totalsRow]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Reports");
  XLSX.writeFile(book, filename);
}