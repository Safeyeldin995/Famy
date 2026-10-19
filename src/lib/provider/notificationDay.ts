import { formatDate } from "@/lib/format";

const cairoCalendar = new Intl.DateTimeFormat("en-CA-u-nu-latn", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function notificationDayKey(date: Date): string {
  const parts = cairoCalendar.formatToParts(date);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}

export function formatNotificationDay(
  date: Date,
  now: Date,
  language: string,
  t: (key: string) => string,
): string {
  const today = notificationDayKey(now);
  const day = notificationDayKey(date);
  if (day === today) return t("proRound2.today");
  // Subtract a calendar day, not 24 hours in Cairo (DST days can differ).
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return t("proRound2.yesterday");
  return formatDate(
    date,
    { timeZone: "Africa/Cairo", weekday: "long", day: "numeric", month: "long" },
    language,
  );
}
