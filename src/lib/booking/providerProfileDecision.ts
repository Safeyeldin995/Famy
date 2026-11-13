type BookCopy = (key: string, options?: Record<string, unknown>) => string;
import { levelRanges } from "../tutoring/levelRanges";
import type { TeachingCapabilityOption } from "../tutoring/teachingCapabilities";
import { joinUiParts } from "../format/uiJoin";
import { isFixedPackage, packageLabel, type PackageService } from "../pricing/servicePackages";
import { formatEGP } from "../format/egp";

type ServiceRow = {
  price_override: number | null;
  service: PackageService & {
    id: string;
    name_ar?: string | null;
    name_en?: string | null;
    category?: { slug?: string | null } | null;
    duration_min?: number | null;
  };
};

export function providerProfileHighlightService(
  rows: ServiceRow[],
  preferredServiceId?: string | null,
) {
  if (!rows.length) return null;
  if (preferredServiceId) {
    const picked = rows.find((row) => row.service.id === preferredServiceId);
    if (picked) return picked;
  }
  return rows[0];
}

export function providerProfilePriceLine(
  row: ServiceRow,
  language: string,
  t: BookCopy,
  opts: {
    hourlyRate?: number | null;
    bookableRate?: number | null;
    capability?: TeachingCapabilityOption | null;
  },
): string {
  const service = row.service;
  const tutoring = service.category?.slug === "tutoring";
  if (opts.capability) {
    return t("providerPage.session", {
      price: formatEGP(opts.capability.price, undefined, language),
      minutes: String(opts.capability.durationMin),
    });
  }
  if (tutoring) {
    return t("customerBooking.tutoringPrice");
  }
  const effective = row.price_override ?? opts.bookableRate ?? opts.hourlyRate;
  if (effective == null) return t("bookFlow.dash");
  if (isFixedPackage(service)) {
    const pack = packageLabel(service);
    return joinUiParts(
      [formatEGP(Number(effective), undefined, language), t(pack.key, pack.values)],
      language,
    );
  }
  return t("providerPage.perHour", { price: formatEGP(Number(effective), undefined, language) });
}

export function providerProfileQualificationLine(
  row: ServiceRow,
  capabilities: TeachingCapabilityOption[],
  language: string,
  t: BookCopy,
): string | null {
  if (row.service.category?.slug !== "tutoring") return null;
  const cap = capabilities.find((c) => c.serviceId === row.service.id);
  if (!cap) return null;
  const ar = language.startsWith("ar");
  const ranges = levelRanges(
    capabilities
      .filter(
        (c) =>
          c.serviceId === row.service.id &&
          c.subjectCode === cap.subjectCode &&
          c.curriculumCode === cap.curriculumCode,
      )
      .map((c) => ({ code: c.levelCode, name: ar ? c.levelNameAr : c.levelNameEn })),
  );
  const grades = ranges
    .map((range) =>
      range.to ? t("providerPage.levelRange", { from: range.from, to: range.to }) : range.from,
    )
    .join("، ");
  return joinUiParts(
    [
      ar ? cap.subjectNameAr : cap.subjectNameEn,
      ar ? cap.curriculumNameAr : cap.curriculumNameEn,
      grades,
    ].filter(Boolean) as string[],
    language,
  );
}
