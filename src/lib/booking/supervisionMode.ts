import { isBabysittingCategorySlug } from "./babysittingRecipient";
import { isTutoringCategorySlug } from "@/lib/tutoring/teachingCapabilities";

export const SUPERVISION_MODES = ["cameras", "adult_present"] as const;
export type SupervisionMode = (typeof SUPERVISION_MODES)[number];

export function requiresSupervisionMode(categorySlug: string | null | undefined): boolean {
  return isBabysittingCategorySlug(categorySlug) || isTutoringCategorySlug(categorySlug);
}

export function isSupervisionMode(value: string | null | undefined): value is SupervisionMode {
  return value === "cameras" || value === "adult_present";
}

/** Online lesson for a child: the parent confirmed they are with the child or supervising. */
export const PARENT_ONLINE_SUPERVISION = "parent_online" as const;
export type BookingSupervisionValue = SupervisionMode | typeof PARENT_ONLINE_SUPERVISION;

/** Any supervision value worth showing on a booking (in-person choice or online parent note). */
export function hasSupervisionNote(
  value: string | null | undefined,
): value is BookingSupervisionValue {
  return isSupervisionMode(value) || value === PARENT_ONLINE_SUPERVISION;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export function supervisionModeOptionLabel(mode: SupervisionMode, t: TranslateFn): string {
  return t(`bookFlow.supervision.${mode}.title`);
}

export function supervisionModeProviderLabel(
  mode: string | null | undefined,
  t: TranslateFn,
): string | null {
  if (!hasSupervisionNote(mode)) return null;
  return t(`bookFlow.supervision.providerLine.${mode}`);
}
