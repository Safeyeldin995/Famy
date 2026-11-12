/** In-flight statuses that need attention right now on the provider jobs tab. */
export const PROVIDER_JOBS_NOW_STATUSES = [
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
] as const;

export type ProviderJobsBooking = { id: string; status?: string; start_at: string };

const cairoCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function cairoBookingDayKey(date = new Date()): string {
  return cairoCalendar.format(date);
}

export function cairoTomorrowDayKey(now = new Date()): string {
  const [year, month, day] = cairoBookingDayKey(now).split("-").map(Number);
  return cairoBookingDayKey(new Date(Date.UTC(year, month - 1, day + 1, 12)));
}

export function isProviderJobsNowStatus(status: string): boolean {
  return (PROVIDER_JOBS_NOW_STATUSES as readonly string[]).includes(status);
}

export type ProviderUpcomingSection<T extends ProviderJobsBooking = ProviderJobsBooking> =
  | { kind: "now"; bookings: T[] }
  | { kind: "today"; bookings: T[] }
  | { kind: "day"; dayKey: string; bookings: T[] };

export function groupProviderUpcomingBookings<T extends ProviderJobsBooking>(
  bookings: readonly T[],
): ProviderUpcomingSection<T>[] {
  const sorted = [...bookings].sort(
    (a, b) => +new Date(a.start_at) - +new Date(b.start_at),
  );
  const todayKey = cairoBookingDayKey(new Date());
  const nowBookings = sorted.filter((b) => isProviderJobsNowStatus(String(b.status ?? "")));
  const nowIds = new Set(nowBookings.map((b) => b.id));
  const rest = sorted.filter((b) => !nowIds.has(b.id));
  const todayBookings = rest.filter(
    (b) => cairoBookingDayKey(new Date(b.start_at)) === todayKey,
  );
  const laterBookings = rest.filter(
    (b) => cairoBookingDayKey(new Date(b.start_at)) !== todayKey,
  );
  const dayGroups = new Map<string, T[]>();
  for (const booking of laterBookings) {
    const key = cairoBookingDayKey(new Date(booking.start_at));
    const group = dayGroups.get(key) ?? [];
    group.push(booking);
    dayGroups.set(key, group);
  }
  const sections: ProviderUpcomingSection<T>[] = [];
  if (nowBookings.length) sections.push({ kind: "now", bookings: nowBookings });
  if (todayBookings.length) sections.push({ kind: "today", bookings: todayBookings });
  for (const [dayKey, items] of [...dayGroups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    sections.push({ kind: "day", dayKey, bookings: items });
  }
  return sections;
}

/** Default jobs tab: requests only when there are pending items and no work today. */
export function defaultProviderJobsTab(
  pendingCount: number,
  upcoming: readonly ProviderJobsBooking[],
  now = new Date(),
): "requests" | "upcoming" {
  const todayKey = cairoBookingDayKey(now);
  const hasWorkToday = upcoming.some((b) => {
    const status = String(b.status ?? "");
    if (isProviderJobsNowStatus(status)) return true;
    return cairoBookingDayKey(new Date(b.start_at)) === todayKey;
  });
  if (pendingCount > 0 && !hasWorkToday) return "requests";
  return "upcoming";
}

export function providerUpcomingDayLabel(
  dayKey: string,
  language: string,
  now = new Date(),
): string {
  const tomorrowKey = cairoTomorrowDayKey(now);
  if (dayKey === tomorrowKey) {
    return language.startsWith("ar") ? "بكرة" : "Tomorrow";
  }
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const locale = language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Africa/Cairo",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}
