import { downloadCsv } from "@/lib/admin/csvExport";
import type { ProviderStatement } from "@/lib/db/admin-daily-ops-queries";

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
  downloadCsv(filename, [
    [labels.title],
    [labels.provider, statement.provider_name],
    [labels.opening, String(statement.opening_balance)],
    [labels.closing, String(statement.closing_balance)],
    [],
    header,
    ...rows,
  ]);
}

export function printStatementPdf(
  statement: ProviderStatement,
  labels: Labels,
  locale: string,
) {
  const ar = locale.startsWith("ar");
  const dir = ar ? "rtl" : "ltr";
  const rows = statement.rows
    .map((row) => {
      const debit = row.direction === "debit" ? row.amount : "";
      const credit = row.direction === "credit" ? row.amount : "";
      const date = new Date(row.created_at).toLocaleString(locale, { timeZone: "Africa/Cairo" });
      return `<tr>
        <td>${date}</td>
        <td>${kindLabel(row.kind, labels)}</td>
        <td dir="ltr">${row.booking_code ? `#${row.booking_code}` : ""}</td>
        <td>${row.price_total ?? ""}</td>
        <td>${row.commission ?? ""}</td>
        <td>${row.provider_share ?? ""}</td>
        <td>${debit}</td>
        <td>${credit}</td>
      </tr>`;
    })
    .join("");
  const html = `<!DOCTYPE html>
<html lang="${ar ? "ar" : "en"}" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <title>${labels.title}</title>
  <style>
    body { font-family: system-ui, "Segoe UI", Tahoma, Arial, sans-serif; margin: 24px; }
    h1 { font-size: 1.25rem; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px; }
    th, td { border: 1px solid #ccc; padding: 6px; text-align: ${ar ? "right" : "left"}; }
    th { background: #f5f5f5; }
    @media print { body { margin: 12px; } }
  </style>
</head>
<body>
  <h1>${labels.title}</h1>
  <p><strong>${labels.provider}:</strong> ${statement.provider_name}</p>
  <p><strong>${labels.opening}:</strong> ${statement.opening_balance}</p>
  <p><strong>${labels.closing}:</strong> ${statement.closing_balance}</p>
  <table>
    <thead><tr>
      <th>${labels.columns.date}</th>
      <th>${labels.columns.kind}</th>
      <th>${labels.columns.booking}</th>
      <th>${labels.columns.price}</th>
      <th>${labels.columns.commission}</th>
      <th>${labels.columns.share}</th>
      <th>${labels.columns.debit}</th>
      <th>${labels.columns.credit}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.addEventListener('load', () => { window.print(); });</script>
</body>
</html>`;
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}