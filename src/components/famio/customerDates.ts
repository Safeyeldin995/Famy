export const CUSTOMER_TIME_ZONE = "Africa/Cairo";

const cairoCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: CUSTOMER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function customerDayKey(date = new Date()): string {
  return cairoCalendar.format(date);
}

const CAIRO_WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function cairoWeekday(date: Date): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: CUSTOMER_TIME_ZONE,
    weekday: "short",
  }).format(date);
  return CAIRO_WEEKDAY[short] ?? date.getDay();
}

export function customerYesterdayKey(now = new Date()): string {
  const [year, month, day] = customerDayKey(now).split("-").map(Number);
  // Calendar subtraction at noon avoids midnight/DST and device-timezone boundaries.
  return customerDayKey(new Date(Date.UTC(year, month - 1, day - 1, 12)));
}

export function isCompleteBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T12:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
