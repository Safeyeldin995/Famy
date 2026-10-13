import { latinCustomerText } from "./customerProviders";
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
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const groups = new Map<string, { key: string; label: string; items: T[] }>();
  for (const item of [...items].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )) {
    const date = new Date(item.created_at);
    const key = date.toDateString();
    const ar = language.startsWith("ar");
    const label =
      key === now.toDateString()
        ? ar
          ? "النهارده"
          : "Today"
        : key === yesterday.toDateString()
          ? ar
            ? "امبارح"
            : "Yesterday"
          : formatDate(date, { day: "numeric", month: "long", year: "numeric" }, language);
    const group = groups.get(key) ?? { key, label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
