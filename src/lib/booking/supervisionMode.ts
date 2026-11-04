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

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export function supervisionModeOptionLabel(mode: SupervisionMode, t: TranslateFn): string {
  return t(`bookFlow.supervision.${mode}.title`);
}

export function supervisionModeProviderLabel(
  mode: string | null | undefined,
  t: TranslateFn,
): string | null {
  if (!isSupervisionMode(mode)) return null;
  return t(`bookFlow.supervision.providerLine.${mode}`);
}
