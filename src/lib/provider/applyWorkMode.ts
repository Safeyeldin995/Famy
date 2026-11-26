import { isEgyptGovernorateCode } from "../geo/egyptGovernorates";

/** How a provider applicant will work. Online only needs no service zone. */
export type ApplyWorkMode = "in_person" | "online" | "both";

export function normalizeApplyWorkMode(value: unknown): ApplyWorkMode {
  return value === "online" || value === "both" ? value : "in_person";
}

type ModeService = {
  online_allowed?: boolean | null;
  category?: { online_allowed?: boolean | null } | null;
};

/** An online-only provider can only offer services that run online. */
export function serviceAllowedForMode(service: ModeService, mode: ApplyWorkMode): boolean {
  if (mode !== "online") return true;
  return service.online_allowed === true && service.category?.online_allowed !== false;
}

export function servicesForMode<T extends ModeService>(services: T[], mode: ApplyWorkMode): T[] {
  return services.filter((s) => serviceAllowedForMode(s, mode));
}

/** Step 1: a name; zones unless online only; a governorate when working online. */
export function applyBasicsReady(draft: {
  name: string;
  mode: ApplyWorkMode;
  governorate: string;
  zones: string[];
}): boolean {
  return (
    !!draft.name.trim() &&
    (draft.mode === "online" || draft.zones.length > 0) &&
    (draft.mode === "in_person" || isEgyptGovernorateCode(draft.governorate))
  );
}
