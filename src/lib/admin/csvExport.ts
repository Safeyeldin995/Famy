/** Excel-friendly UTF-8 CSV with BOM. Neutralizes formula-injection prefixes. */

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Prefix cells that Excel/Sheets would treat as a formula. */
export function neutralizeCsvCell(cell: unknown): string {
  const value = String(cell ?? "");
  if (FORMULA_PREFIX.test(value)) return `'${value}`;
  return value;
}

export function escapeCsvCell(cell: unknown): string {
  const neutralized = neutralizeCsvCell(cell);
  if (FORMULA_PREFIX.test(String(cell ?? "")) || /[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export function csvBody(rows: string[][]): string {
  return rows.map((r) => r.map((cell) => escapeCsvCell(cell)).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, rows: string[][]) {
  const body = csvBody(rows);
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
