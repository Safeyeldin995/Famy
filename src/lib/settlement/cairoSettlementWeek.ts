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

/** Cairo wall-clock parts for an instant. */
function cairoParts(d: Date): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
}

/** Instant of 00:00 Cairo time on the given Cairo calendar day (month is 1-based; overflow allowed). */
export function cairoMidnight(year: number, month: number, day: number): Date {
  const target = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = cairoParts(new Date(guess));
    const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, 0, 0);
    const next = guess + (target - wall);
    if (next === guess) break;
    guess = next;
  }
  // On the spring DST change Cairo skips 00:00, so the loop can land on 23:00 of the
  // previous day. Move forward to the first instant that is on the requested day.
  const want = new Date(target);
  for (let i = 0; i < 3; i++) {
    const p = cairoParts(new Date(guess));
    const sameDay =
      p.y === want.getUTCFullYear() && p.m === want.getUTCMonth() + 1 && p.d === want.getUTCDate();
    if (sameDay) break;
    guess += 60 * 60 * 1000;
  }
  return new Date(guess);
}

/** ISO range for a finance-page period preset (Cairo calendar). `to` is exclusive. */
export function financeRangeForPreset(
  preset: Exclude<FinancePreset, "custom">,
  period: SettlementClosedPeriod,
  now: Date = new Date(),
): { from: string; to: string } {
  if (preset === "lastWeek") return { from: period.period_start, to: period.period_end };
  if (preset === "thisMonth") {
    const c = cairoParts(now);
    return { from: cairoMidnight(c.y, c.m, 1).toISOString(), to: now.toISOString() };
  }
  // A long-open page can hold an anchor older than a newly closed week: never return from > to.
  const end = now.getTime() > Date.parse(period.period_end) ? now : new Date();
  return { from: period.period_end, to: end.toISOString() };
}

/** Custom range from two `yyyy-mm-dd` inputs read as Cairo days (end day inclusive). */
export function financeRangeForDays(
  fromDay: string,
  toDay: string,
): { from: string; to: string } | null {
  const parse = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? ([Number(m[1]), Number(m[2]), Number(m[3])] as const) : null;
  };
  const a = parse(fromDay);
  const b = parse(toDay);
  if (!a || !b) return null;
  const start = cairoMidnight(a[0], a[1], a[2]);
  const end = cairoMidnight(b[0], b[1], b[2] + 1);
  if (end.getTime() <= start.getTime()) return null;
  return { from: start.toISOString(), to: end.toISOString() };
}
