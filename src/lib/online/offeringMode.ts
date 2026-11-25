export type ProviderOfferingMode = "in_person" | "online" | "both";

const OFFERING_MODES: ProviderOfferingMode[] = ["in_person", "online", "both"];

export function normalizeOfferingMode(raw: unknown): ProviderOfferingMode {
  if (typeof raw === "string" && OFFERING_MODES.includes(raw as ProviderOfferingMode)) {
    return raw as ProviderOfferingMode;
  }
  return "in_person";
}

export function offeringModeAllowsOnline(mode: ProviderOfferingMode | string | null | undefined): boolean {
  return mode === "online" || mode === "both";
}

export function offeringModeAllowsInPerson(
  mode: ProviderOfferingMode | string | null | undefined,
): boolean {
  return mode === "in_person" || mode === "both";
}

/** UI: only in-person stays selectable when online is not allowed. */
export function isOfferingModeOptionDisabled(
  mode: ProviderOfferingMode,
  canEnableOnline: boolean,
): boolean {
  return !canEnableOnline && mode !== "in_person";
}

export function isOfferingModeSaveAllowed(
  mode: ProviderOfferingMode,
  canEnableOnline: boolean,
): boolean {
  return canEnableOnline || mode === "in_person";
}