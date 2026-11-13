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
  const from = formatInstantForDatetimeLocal(period.period_start);
  const to = formatInstantForDatetimeLocal(new Date().toISOString());
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
