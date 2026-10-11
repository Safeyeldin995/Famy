type Rule = { weekday: number; start_time: string; end_time: string };
type Translate = (key: string, values?: Record<string, unknown>) => string;

export function workingHoursSummary(rules: Rule[], t: Translate): string[] {
  const days = new Map<number, string[]>();
  for (const rule of rules) {
    const interval = `${rule.start_time.slice(0, 5)}-${rule.end_time.slice(0, 5)}`;
    days.set(rule.weekday, [...new Set([...(days.get(rule.weekday) ?? []), interval])].sort());
  }
  const ranges: { start: number; end: number; intervals: string[] }[] = [];
  for (const [day, intervals] of [...days].sort(([a], [b]) => a - b)) {
    const last = ranges[ranges.length - 1];
    if (last && day === last.end + 1 && intervals.join() === last.intervals.join()) last.end = day;
    else ranges.push({ start: day, end: day, intervals });
  }
  const time = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    if ((hour === 24 || hour === 0) && minute === 0) return t("providerProfileV3.hoursMidnight");
    return t(hour < 12 ? "providerProfileV3.hoursAm" : "providerProfileV3.hoursPm", {
      time: `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}`,
    });
  };
  return ranges.map(({ start, end, intervals }) => {
    const first = t(`providerProfileV3.days.d${start}`);
    const dayLabel =
      start === end
        ? first
        : t("providerProfileV3.hoursDays", {
            from: first,
            to: t(`providerProfileV3.days.d${end}`),
          });
    const hours = intervals
      .map((interval) => {
        const [from, to] = interval.split("-");
        return t("providerProfileV3.hoursTimes", { from: time(from), to: time(to) });
      })
      .join(" · ");
    return `${dayLabel} · ${hours}`;
  });
}
