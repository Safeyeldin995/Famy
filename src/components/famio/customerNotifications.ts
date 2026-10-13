import { latinCustomerText } from "./customerProviders";
import i18n from "@/lib/i18n";
import { CUSTOMER_TIME_ZONE, customerDayKey, customerYesterdayKey } from "./customerDates";
import { formatDate } from "@/lib/format";

type LocalizedNotification = {
  title?: string | null;
  title_ar?: string | null;
  title_en?: string | null;
  body?: string | null;
  body_ar?: string | null;
  body_en?: string | null;
};

export function notificationText(n: LocalizedNotification, language: string) {
  return language.startsWith("ar")
    ? {
        title: latinCustomerText(n.title_ar || n.title_en || n.title),
        body: latinCustomerText(n.body_ar || n.body_en || n.body),
      }
    : { title: n.title_en || n.title, body: n.body_en || n.body };
}

export function groupCustomerNotifications<T extends { created_at: string }>(
  items: T[],
  language: string,
  now = new Date(),
): { key: string; label: string; items: T[] }[] {
  const today = customerDayKey(now);
  const yesterday = customerYesterdayKey(now);
  const t = i18n.getFixedT(language);
  const groups = new Map<string, { key: string; label: string; items: T[] }>();
  for (const item of [...items].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )) {
    const date = new Date(item.created_at);
    const key = customerDayKey(date);
    const label =
      key === today
        ? t("customerRound2.notificationToday")
        : key === yesterday
          ? t("customerRound2.notificationYesterday")
          : formatDate(
              date,
              { day: "numeric", month: "long", year: "numeric", timeZone: CUSTOMER_TIME_ZONE },
              language,
            );
    const group = groups.get(key) ?? { key, label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function formatCustomerNotificationTime(date: Date, language: string): string {
  return formatDate(
    date,
    { hour: "numeric", minute: "2-digit", hour12: true, timeZone: CUSTOMER_TIME_ZONE },
    language,
  );
}
