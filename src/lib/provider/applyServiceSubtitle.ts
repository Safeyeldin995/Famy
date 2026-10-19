import type { TFunction } from "i18next";
import { isFixedPackage, packageEndTime, type PackageService } from "@/lib/pricing/servicePackages";

function clockLabel(value: string, t: TFunction): string {
  const [hours, minutes] = value.split(":").map(Number);
  const hour = hours % 24;
  if (hour === 0 && minutes === 0) return t("providerApply.subtitles.midnight");
  const time = `${hour % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
  return t(`providerApply.subtitles.${hour < 12 ? "morning" : "evening"}`, { time });
}

export function applyServiceSubtitle(
  service: PackageService & { category?: { slug?: string | null } | null },
  t: TFunction,
): string {
  if (service.category?.slug === "tutoring") return t("providerApply.subtitles.tutoring");
  if (!isFixedPackage(service)) return t("providerApply.subtitles.hourly");
  if (service.fixed_start_time) {
    return t("providerApply.subtitles.timed", {
      start: clockLabel(service.fixed_start_time, t),
      end: clockLabel(packageEndTime(service), t),
    });
  }
  return t("providerApply.subtitles.continuous", { hours: (service.duration_min ?? 0) / 60 });
}
