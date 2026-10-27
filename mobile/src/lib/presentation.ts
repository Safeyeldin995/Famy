import type { Provider } from "./queries";
export function localized(
  row: { name_ar?: string | null; name_en?: string | null } | null | undefined,
  language: string,
) {
  return (language.startsWith("ar") ? row?.name_ar : row?.name_en) || row?.name_en || "";
}
export function money(value: number | string, language: string) {
  return new Intl.NumberFormat(language === "ar" ? "ar-EG-u-nu-latn" : "en-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 2,
  }).format(Number(value));
}
export function dateTime(value: string, language: string) {
  return new Intl.DateTimeFormat(language === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(new Date(value));
}
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

// Source: src/lib/tutoring/tutoringProviderMatch.ts - pure match and stable partition.
import type { TeachingCapabilityOption } from "@shared/tutoring/teachingCapabilities";

export type TutoringMatchContext = {
  serviceId: string | null | undefined;
  curriculumId: string | null;
  levelId: string | null;
  studentFirstName: string | null;
};

export function providerMatchesStudentEducation(
  providerId: string,
  capabilities: TeachingCapabilityOption[],
  ctx: Pick<TutoringMatchContext, "serviceId" | "curriculumId" | "levelId">,
): boolean {
  if (!ctx.curriculumId || !ctx.levelId) return false;
  return capabilities.some(
    (cap) =>
      cap.providerId === providerId &&
      cap.status === "approved" &&
      (!ctx.serviceId || cap.serviceId === ctx.serviceId) &&
      cap.curriculumId === ctx.curriculumId &&
      cap.levelId === ctx.levelId,
  );
}

export function sortProvidersForStudentEducation<T extends { id: string }>(
  providers: T[],
  capabilities: TeachingCapabilityOption[],
  ctx: Pick<TutoringMatchContext, "serviceId" | "curriculumId" | "levelId">,
): T[] {
  if (!ctx.curriculumId || !ctx.levelId) return providers;
  const matched: T[] = [];
  const rest: T[] = [];
  for (const provider of providers) {
    if (providerMatchesStudentEducation(provider.id, capabilities, ctx)) {
      matched.push(provider);
    } else {
      rest.push(provider);
    }
  }
  return [...matched, ...rest];
}

export function tutoringMatchBadgeLabel(
  studentFirstName: string | null,
  t: (key: string, options?: Record<string, string>) => string,
): string | undefined {
  if (!studentFirstName) return undefined;
  return t("studentEducation.matchBadge", { name: studentFirstName });
}
