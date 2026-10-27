import {
  CUSTOMER_TIME_ZONE,
  customerDayKey,
  customerYesterdayKey,
} from "../../../src/components/famio/customerDates";

/** Same Cairo calendar boundaries as the web, independent of the device timezone. */
export function customerNotificationGroups<T extends { created_at: string }>(
  items: T[],
  now = new Date(),
) {
  const today = customerDayKey(now);
  const yesterday = customerYesterdayKey(now);
  const groups = new Map<
    string,
    { key: string; labelKey: string | null; date: Date; items: T[] }
  >();
  for (const item of [...items].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )) {
    const date = new Date(item.created_at);
    const key = customerDayKey(date);
    const group = groups.get(key) ?? {
      key,
      labelKey:
        key === today
          ? "customerRound2.notificationToday"
          : key === yesterday
            ? "customerRound2.notificationYesterday"
            : null,
      date,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
export function customerNotificationDate(date: Date, language: string, time = false) {
  return new Intl.DateTimeFormat(language === "ar" ? "ar-EG-u-nu-latn" : "en-EG", {
    timeZone: CUSTOMER_TIME_ZONE,
    ...(time
      ? ({ hour: "numeric", minute: "2-digit", hour12: true } as const)
      : ({ day: "numeric", month: "long", year: "numeric" } as const)),
  }).format(date);
}
