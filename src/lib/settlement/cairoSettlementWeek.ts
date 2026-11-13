/** Cairo-aligned settlement week boundaries from `provider_settlement_closed_period`. */

export type SettlementClosedPeriod = {
  period_start: string;
  period_end: string;
  next_settlement_at: string;
};

/** `datetime-local` value using the viewer's local calendar clock (no UTC slice). */
export function formatInstantForDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function defaultFinanceRangeFromPeriod(period: SettlementClosedPeriod): {
  from: string;
  to: string;
} {
  const from = formatInstantForDatetimeLocal(period.period_end);
  const to = formatInstantForDatetimeLocal(new Date().toISOString());
  return { from, to };
}

/** Upper bound for in-progress week ledger totals (used inside queryFn, not query keys). */
export function currentWeekLedgerUpperBound(
  period: Pick<SettlementClosedPeriod, "next_settlement_at">,
  now: Date = new Date(),
): string {
  const nextMs = new Date(period.next_settlement_at).getTime();
  return now.getTime() < nextMs ? now.toISOString() : period.next_settlement_at;
}

/** Ledger activity for the in-progress week: from last close through now (capped at next settlement). */
export function currentWeekLedgerRange(
  period: SettlementClosedPeriod,
  now: Date = new Date(),
): { from: string; to: string } {
  return {
    from: period.period_end,
    to: currentWeekLedgerUpperBound(period, now),
  };
}

export function formatSettlementWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  return d.toLocaleString(locale === "ar" ? "ar-EG" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Cairo",
  });
}

export type FinancePreset = "thisWeek" | "lastWeek" | "thisMonth" | "custom";

/** ISO range for a finance-page period preset. `to` is exclusive. */
export function financeRangeForPreset(
  preset: Exclude<FinancePreset, "custom">,
  period: SettlementClosedPeriod,
  now: Date = new Date(),
): { from: string; to: string } {
  if (preset === "lastWeek") return { from: period.period_start, to: period.period_end };
  if (preset === "thisMonth") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { from: start.toISOString(), to: now.toISOString() };
  }
  return { from: period.period_end, to: now.toISOString() };
}

/** Custom range from two `yyyy-mm-dd` day inputs (local days, end day inclusive). */
export function financeRangeForDays(fromDay: string, toDay: string): { from: string; to: string } | null {
  const parse = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0) : null;
  };
  const a = parse(fromDay);
  const b = parse(toDay);
  if (!a || !b) return null;
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1, 0, 0, 0, 0);
  if (end.getTime() <= a.getTime()) return null;
  return { from: a.toISOString(), to: end.toISOString() };
}
