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
