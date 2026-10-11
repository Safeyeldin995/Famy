/** Shared display formatting for the When and Review screens; digit policy stays unchanged. */
export function bookingTimeLabel(time: Date, locale: string, cairoTime: boolean) {
  return time.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    ...(cairoTime ? { timeZone: "Africa/Cairo" } : {}),
  });
}

export function bookingWhenValues(
  date: Date,
  slot: { start: Date; end: Date },
  locale: string,
  cairoTime: boolean,
) {
  return {
    date: date.toLocaleDateString(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
    start: bookingTimeLabel(slot.start, locale, cairoTime),
    end: bookingTimeLabel(slot.end, locale, cairoTime),
  };
}
