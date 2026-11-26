/** Excel-friendly UTF-8 CSV with BOM. Neutralizes formula-injection prefixes. */

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Prefix cells that Excel/Sheets would treat as a formula. */
export function neutralizeCsvCell(cell: unknown): string {
  const value = String(cell ?? "");
  if (FORMULA_PREFIX.test(value)) return `'${value}`;
  return value;
}

export function escapeCsvCell(cell: unknown): string {
  const raw = String(cell ?? "");
  const neutralized = neutralizeCsvCell(cell);
  if (FORMULA_PREFIX.test(raw) || /[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

/** Strip path/formula-hostile characters from download filenames. */
export function sanitizeDownloadFilename(name: string): string {
  const trimmed = String(name ?? "export").trim().replace(/[\\/:*?"<>|\r\n]+/g, "_");
  const safe = trimmed.replace(/^[\s.=+\-@]+/, "").slice(0, 160);
  return safe || "export";
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
  const base = sanitizeDownloadFilename(filename.replace(/\.csv$/i, ""));
  a.download = `${base}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
