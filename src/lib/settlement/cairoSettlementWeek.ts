/** Cairo-aligned settlement week boundaries from `provider_settlement_closed_period`. */

export type SettlementClosedPeriod = {
  period_start: string;
  period_end: string;
  next_settlement_at: string;
};

export function defaultFinanceRangeFromPeriod(period: SettlementClosedPeriod): {
  from: string;
  to: string;
} {
  const from = period.period_start;
  const to = new Date().toISOString();
  return { from, to };
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
