export const ONLINE_WEB_TIME_ZONE = "Africa/Cairo";

const DAY_MS = 86_400_000;

/** Cairo calendar date (YYYY-MM-DD) for an instant. */
export function cairoYmd(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ONLINE_WEB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

/** Midnight Cairo on a calendar day as a `Date` (via UTC noon trick for stable formatting). */
export function cairoDayStartFromYmd(ymd: string): Date {
  const { y, m, d } = parseYmd(ymd);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ONLINE_WEB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(probe);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")),
  );
}

/** Add whole days to a Cairo calendar Y-M-D without shifting the zero-day case. */
export function cairoDatePlusDays(ymd: string, days: number): string {
  if (days === 0) return ymd;
  const { y, m, d } = parseYmd(ymd);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  cursor.setUTCDate(cursor.getUTCDate() + days);
  const yy = cursor.getUTCFullYear();
  const mm = String(cursor.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(cursor.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function cairoTodayStart(): Date {
  return cairoDayStartFromYmd(cairoYmd(new Date()));
}

export function cairoDayStrip(count = 14): Date[] {
  const startYmd = cairoYmd(new Date());
  const out: Date[] = [];
  for (let i = 0; i < count; i++) {
    out.push(cairoDayStartFromYmd(cairoDatePlusDays(startYmd, i)));
  }
  return out;
}

export function sameCairoCalendarDay(a: Date, b: Date): boolean {
  return cairoYmd(a) === cairoYmd(b);
}

/** Local midnight on the Cairo Y-M-D calendar day (for slot queries with `cairoTime: true`). */
export function localMidnightFromCairoYmd(ymd: string): Date {
  const { y, m, d } = parseYmd(ymd);
  return new Date(y, m - 1, d);
}

export function localMidnightForCairoInstant(instant: Date): Date {
  return localMidnightFromCairoYmd(cairoYmd(instant));
}