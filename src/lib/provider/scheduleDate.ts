/** Keep date-only values local and serialize exactly as the existing date inputs did. */
export function scheduleDate(parts: { year: string; month: string; day: string }): string | null {
  if (!parts.year || !parts.month || !parts.day) return null;
  const year = Number(parts.year),
    month = Number(parts.month),
    day = Number(parts.day);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${parts.year}-${parts.month.padStart(2, "0")}-${parts.day.padStart(2, "0")}`;
}

/** Display-only labels: persisted time values remain HH:MM. */
export function timeChoiceLabel(value: string, language: string) {
  const ar = language.startsWith("ar");
  if (value === "24:00") return ar ? "12 بالليل" : "midnight";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(ar ? "ar-EG-u-nu-latn" : "en-EG", {
    timeZone: "UTC",
    hour: "numeric",
    ...(minute ? { minute: "2-digit" as const } : {}),
    hour12: true,
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

export function scheduleTimeChoices(current: string, end: boolean) {
  return [
    ...new Set([
      ...Array.from(
        { length: end ? 49 : 48 },
        (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
      ),
      current,
    ]),
  ].sort();
}

/** Format date-only data in UTC so the displayed calendar day never shifts. */
export function scheduleDateLabel(value: string, language: string, weekday = false) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const parts = new Intl.DateTimeFormat(language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-EG", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    ...(weekday ? { weekday: "long" as const } : {}),
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return [weekday ? part("weekday") : undefined, part("day"), part("month")]
    .filter(Boolean)
    .join(" ");
}


export function scheduleYears(today: Date): number[] {
  return [today.getFullYear(), today.getFullYear() + 1];
}

export function scheduleToday(today: Date) {
  return { year: String(today.getFullYear()), month: String(today.getMonth() + 1), day: String(today.getDate()) };
}

export function scheduleMonthDays(year: string, month: string): number {
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
}

export function updateScheduleDate(parts: { year: string; month: string; day: string }, key: "year" | "month" | "day", value: string) {
  const next = { ...parts, [key]: value };
  next.day = String(Math.min(Number(next.day), scheduleMonthDays(next.year, next.month)));
  return next;
}

export function validateScheduleRange(start: string | null, end: string | null, today: Date): "invalidDate" | "startPast" | "endBeforeStart" | null {
  if (!start || !end) return "invalidDate";
  if (start < scheduleDate(scheduleToday(today))!) return "startPast";
  if (end < start) return "endBeforeStart";
  return null;
}
