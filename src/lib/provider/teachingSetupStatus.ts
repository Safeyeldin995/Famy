import { levelRanges } from "@/lib/tutoring/levelRanges";
export function missingTeachingServices<T extends { id: string }>(
  services: T[],
  rows: { service_id: string; status: string }[],
) {
  return services.filter(
    (service) => !rows.some((row) => row.service_id === service.id && row.status !== "rejected"),
  );
}
export function gradeSummary(
  levels: { code: string; name_ar: string; name_en: string }[],
  ar: boolean,
) {
  return levelRanges(
    levels.map((level) => ({ code: level.code, name: ar ? level.name_ar : level.name_en })),
  )
    .map((range) =>
      range.to
        ? ar
          ? `من ${range.from} لحد ${range.to}`
          : `${range.from} to ${range.to}`
        : range.from,
    )
    .join(ar ? "، " : ", ");
}
export function teachingDuration(minutes: number, ar: boolean) {
  const labels: Record<number, [string, string]> = {
    60: ["ساعة", "One hour"],
    90: ["ساعة ونص", "One and a half hours"],
    120: ["ساعتين", "Two hours"],
    180: ["3 ساعات", "Three hours"],
  };
  return labels[minutes]?.[ar ? 0 : 1] ?? `${minutes} ${ar ? "دقيقة" : "minutes"}`;
}
