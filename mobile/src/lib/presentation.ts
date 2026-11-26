import type { Provider } from "./queries";
import { formatEGP } from "@shared/format/egp";

export function localized(
  row: { name_ar?: string | null; name_en?: string | null } | null | undefined,
  language: string,
) {
  return (language.startsWith("ar") ? row?.name_ar : row?.name_en) || row?.name_en || "";
}

export function money(value: number | string, language: string) {
  return formatEGP(Number(value), undefined, language);
}
export function dateTime(value: string, language: string) {
  return new Intl.DateTimeFormat(language === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(new Date(value));
}

export { formatCustomerBookingListWhen as customerBookingListWhen } from "@shared/format/customerBookingListWhen";
// Source: src/components/famio/customerProviders.ts - preserve categories when combining results.
export function uniqueProviders(rows: Provider[]) {
  const seen = new Map<string, Provider>();
  for (const row of rows) {
    const previous = seen.get(row.id);
    if (!previous) seen.set(row.id, { ...row, services: [...row.services] });
    else {
      const ids = new Set(previous.services.map((entry) => entry.service.id));
      previous.services.push(...row.services.filter((entry) => !ids.has(entry.service.id)));
    }
  }
  return [...seen.values()];
}
// Source: src/lib/home/rebookProviders.ts - completed bookings, unique providers, newest first.
export function recentProviders(rows: { status: string; provider: Provider | null }[]) {
  return uniqueProviders(
    rows.filter((b) => b.status === "completed" && b.provider).map((b) => b.provider!),
  ).slice(0, 5);
}
// Source: src/components/famio/customerNotifications.ts (pure localized fallback only).
export function notificationText(n: Record<string, unknown>, language: string) {
  return {
    title: String((language === "ar" && n.title_ar) || n.title_en || n.title || ""),
    body: String((language === "ar" && n.body_ar) || n.body_en || n.body || ""),
  };
}
export const activeStatuses = [
  "pending",
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
  "disputed",
];

