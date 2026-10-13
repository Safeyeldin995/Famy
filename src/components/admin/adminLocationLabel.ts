import type { TFunction } from "i18next";

type ZoneName = { name_en?: string | null; name_ar?: string | null };

/** Display-only translation; stored city/area values are never rewritten. */
export function adminLocationLabel(
  value: string | null | undefined,
  language: string,
  t: TFunction,
  zones: ZoneName[] = [],
): string {
  const stored = value?.trim();
  if (!stored || language !== "ar") return stored ?? "";
  const matched = zones.find((zone) => zone.name_en?.trim().toLowerCase() === stored.toLowerCase());
  if (matched?.name_ar?.trim()) return matched.name_ar.trim();
  const key = stored
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return String(t(`adminReview.locationNames.${key}`, { defaultValue: stored }));
}
