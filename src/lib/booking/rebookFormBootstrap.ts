import type { SupervisionMode } from "./supervisionMode";
import { applyRebookPrefill, buildRebookPrefillContext } from "./rebookPrefillContext";
import type {
  RebookPrefillNotice,
  RebookPrefillResult,
  RebookPrefillValues,
  RebookSourceBooking,
} from "./rebookPrefill";
export type RebookEducationProfileValue = {
  educationCurriculumId: string;
  educationLevelId: string;
};

function educationValueFromIds(
  curriculumId: string | null,
  levelId: string | null,
): RebookEducationProfileValue {
  return {
    educationCurriculumId: curriculumId ?? "",
    educationLevelId: levelId ?? "",
  };
}

export type RebookSeedField =
  | "serviceId"
  | "capabilityId"
  | "addressId"
  | "forWhom"
  | "supervisionMode"
  | "duration"
  | "notes"
  | "requirementChoices"
  | "education";

export type RebookFormInitial = {
  serviceId: string | null;
  capabilityId: string | null;
  durationHours: number | null;
  addressId: string | null;
  forWhom: string;
  supervisionMode: SupervisionMode | "";
  notes: string;
  requirementChoices: Record<string, "customer" | "provider">;
  education: RebookEducationProfileValue;
  capabilityUserPicked: boolean;
  seededFields: ReadonlySet<RebookSeedField>;
  notices: RebookPrefillNotice[];
};

export function rebookBootstrapQueriesLoading(input: {
  rebookFrom?: string;
  bookingLoading: boolean;
  bookingSuccess: boolean;
  servicesReady: boolean;
  addressesLoading: boolean;
  membersLoading: boolean;
  capsLoading: boolean;
  requirementsLoading: boolean;
  bookableLoading: boolean;
}): boolean {
  if (!input.rebookFrom) return false;
  if (input.bookingLoading || !input.bookingSuccess) return true;
  if (!input.servicesReady || input.addressesLoading || input.membersLoading) return true;
  if (input.capsLoading || input.requirementsLoading || input.bookableLoading) return true;
  return false;
}

function collectSeededFields(
  values: RebookPrefillValues,
  source: RebookSourceBooking,
): Set<RebookSeedField> {
  const seeded = new Set<RebookSeedField>();
  if (values.serviceId) seeded.add("serviceId");
  if (values.capabilityId) seeded.add("capabilityId");
  if (values.addressId) seeded.add("addressId");
  seeded.add("forWhom");
  if (values.supervisionMode) seeded.add("supervisionMode");
  if (values.hours) seeded.add("duration");
  if (values.notes?.trim()) seeded.add("notes");
  if (Object.keys(values.requirementChoices).length) seeded.add("requirementChoices");
  if (values.curriculumId || values.levelId) seeded.add("education");
  return seeded;
}

export function buildRebookFormInitial(
  result: RebookPrefillResult,
  booking: RebookSourceBooking,
  fallbackAddressId: string | null,
): RebookFormInitial {
  const { values, notices } = result;
  const seededFields = collectSeededFields(values, booking);
  return {
    serviceId: values.serviceId ?? null,
    capabilityId: values.capabilityId ?? null,
    durationHours: values.hours ?? null,
    addressId: values.addressId ?? fallbackAddressId,
    forWhom: values.forWhom,
    supervisionMode: values.supervisionMode,
    notes: values.notes,
    requirementChoices: values.requirementChoices,
    education: educationValueFromIds(values.curriculumId ?? null, values.levelId ?? null),
    capabilityUserPicked: !!values.capabilityId,
    seededFields,
    notices,
  };
}

export function computeRebookFormBootstrap(input: {
  rebookFrom?: string;
  providerId: string;
  booking: RebookSourceBooking | null | undefined;
  services: Parameters<typeof buildRebookPrefillContext>[0]["services"];
  bookableServiceIds: Set<string>;
  addresses: Parameters<typeof buildRebookPrefillContext>[0]["addresses"];
  familyMembers: Parameters<typeof buildRebookPrefillContext>[0]["familyMembers"];
  capabilities: Parameters<typeof buildRebookPrefillContext>[0]["capabilities"];
  bookingRequirements: Parameters<typeof buildRebookPrefillContext>[0]["bookingRequirements"];
  fallbackAddressId: string | null;
}): RebookFormInitial | null {
  if (!input.rebookFrom || !input.booking) return null;
  if (input.booking.provider_id !== input.providerId) return null;
  const ctx = buildRebookPrefillContext({
    providerId: input.providerId,
    services: input.services,
    bookableServiceIds: input.bookableServiceIds,
    addresses: input.addresses,
    familyMembers: input.familyMembers,
    capabilities: input.capabilities,
    bookingRequirements: input.bookingRequirements,
  });
  const result = applyRebookPrefill(input.booking, ctx);
  if (!result) return null;
  return buildRebookFormInitial(result, input.booking, input.fallbackAddressId);
}
