/**
 * Admin-configurable Famy commission rate.
 * Empty / null means "not set" — never invent a default number.
 */
export const COMMISSION_PERCENT_MIN = 0;
export const COMMISSION_PERCENT_MAX = 50;
export const COMMISSION_PERCENT_MAX_DECIMALS = 2;

export type CommissionPercentParseOk = { ok: true; value: number | null };
export type CommissionPercentParseErr = {
  ok: false;
  reason: "invalid" | "range" | "decimals";
};
export type CommissionPercentParseResult = CommissionPercentParseOk | CommissionPercentParseErr;

export function parseCommissionPercent(raw: unknown): CommissionPercentParseResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "string" && raw.trim() === "") return { ok: true, value: null };

  const text = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : String(raw).trim();
  if (text === "") return { ok: true, value: null };
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, reason: "invalid" };

  const decimals = text.includes(".") ? text.split(".")[1].length : 0;
  if (decimals > COMMISSION_PERCENT_MAX_DECIMALS) return { ok: false, reason: "decimals" };

  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, reason: "invalid" };
  if (n < COMMISSION_PERCENT_MIN || n > COMMISSION_PERCENT_MAX)
    return { ok: false, reason: "range" };
  return { ok: true, value: n };
}

export function commissionPercentEqual(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}
