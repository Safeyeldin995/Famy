import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ProviderStatement, ProviderStatementRow } from "@/lib/db/admin-daily-ops-queries";

type Labels = {
  title: string;
  provider: string;
  period: string;
  opening: string;
  closing: string;
  columns: {
    date: string;
    kind: string;
    booking: string;
    price: string;
    commission: string;
    share: string;
    debit: string;
    credit: string;
    note: string;
  };
  kindLabels: Record<string, string>;
};

function kindLabel(kind: string, labels: Labels) {
  return labels.kindLabels[kind] ?? kind;
}

function rowCells(row: ProviderStatementRow, labels: Labels, locale: string) {
  const debit = row.direction === "debit" ? row.amount : "";
  const credit = row.direction === "credit" ? row.amount : "";
  const date = new Date(row.created_at).toLocaleString(locale, { timeZone: "Africa/Cairo" });
  return [
    date,
    kindLabel(row.kind, labels),
    row.booking_code ? `#${row.booking_code}` : "",
    row.price_total ?? "",
    row.commission ?? "",
    row.provider_share ?? "",
    debit,
    credit,
    row.note ?? "",
  ];
}

export function downloadStatementExcel(
  statement: ProviderStatement,
  labels: Labels,
  filename: string,
) {
  const header = [
    labels.columns.date,
    labels.columns.kind,
    labels.columns.booking,
    labels.columns.price,
    labels.columns.commission,
    labels.columns.share,
    labels.columns.debit,
    labels.columns.credit,
    labels.columns.note,
  ];
  const rows = statement.rows.map((r) => rowCells(r, labels, "ar-EG-u-nu-latn"));
  const sheet = XLSX.utils.aoa_to_sheet([
    [labels.title],
    [labels.provider, statement.provider_name],
    [labels.opening, statement.opening_balance],
    [labels.closing, statement.closing_balance],
    [],
    header,
    ...rows,
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Statement");
  XLSX.writeFile(book, filename);
}

export function downloadStatementPdf(
  statement: ProviderStatement,
  labels: Labels,
  filename: string,
  locale: string,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
  const ar = locale.startsWith("ar");
  doc.setFontSize(14);
  doc.text(labels.title, 40, 40);
  doc.setFontSize(10);
  doc.text(`${labels.provider}: ${statement.provider_name}`, 40, 58);
  doc.text(
    `${labels.period}: ${new Date(statement.period_from).toLocaleDateString(locale, { timeZone: "Africa/Cairo" })} — ${new Date(statement.period_to).toLocaleDateString(locale, { timeZone: "Africa/Cairo" })}`,
    40,
    72,
  );
  doc.text(`${labels.opening}: ${statement.opening_balance}`, 40, 86);
  doc.text(`${labels.closing}: ${statement.closing_balance}`, 40, 100);

  autoTable(doc, {
    startY: 112,
    head: [
      [
        labels.columns.date,
        labels.columns.kind,
        labels.columns.booking,
        labels.columns.price,
        labels.columns.commission,
        labels.columns.share,
        labels.columns.debit,
        labels.columns.credit,
        labels.columns.note,
      ],
    ],
    body: statement.rows.map((r) => rowCells(r, labels, ar ? "ar-EG-u-nu-latn" : "en-GB")),
    styles: { fontSize: 8, halign: ar ? "right" : "left" },
    headStyles: { fillColor: [120, 20, 80] },
  });
  doc.save(filename);
}