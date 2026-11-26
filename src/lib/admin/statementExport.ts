import { downloadCsv } from "@/lib/admin/csvExport";
import type { ProviderStatement } from "@/lib/db/admin-daily-ops-queries";

type Labels = {
  title: string;
  provider: string;
  period: string;
  opening: string;
  closing: string;
  periodNet: string;
  columns: {
    date: string;
    kind: string;
    booking: string;
    price: string;
    commission: string;
    share: string;
    debit: string;
    credit: string;
  };
  kindLabels: Record<string, string>;
};

function kindLabel(kind: string, labels: Labels) {
  return (labels.kindLabels as Record<string, string>)[kind] ?? kind;
}

export function downloadStatementCsv(
  statement: ProviderStatement,
  labels: Labels,
  filename: string,
  locale: string,
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
  ];
  const rows = statement.rows.map((row) => {
    const debit = row.direction === "debit" ? String(row.amount) : "";
    const credit = row.direction === "credit" ? String(row.amount) : "";
    const date = new Date(row.created_at).toLocaleString(locale, { timeZone: "Africa/Cairo" });
    return [
      date,
      kindLabel(row.kind, labels),
      row.booking_code ? `#${row.booking_code}` : "",
      row.price_total != null ? String(row.price_total) : "",
      row.commission != null ? String(row.commission) : "",
      row.provider_share != null ? String(row.provider_share) : "",
      debit,
      credit,
    ];
  });
  const periodLabel = `${statement.period_from} – ${statement.period_to}`;
  downloadCsv(filename, [
    [labels.title],
    [labels.provider, statement.provider_name],
    [labels.period, periodLabel],
    [labels.opening, String(statement.opening_balance)],
    [labels.periodNet, String(statement.period_net)],
    [labels.closing, String(statement.closing_balance)],
    [],
    header,
    ...rows,
  ]);
}
