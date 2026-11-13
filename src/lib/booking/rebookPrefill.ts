import { isFixedPackage, type PackageService } from "@/lib/pricing/servicePackages";
import { isSupervisionMode, type SupervisionMode } from "./supervisionMode";

export type RebookNoticeCode =
  | "serviceUnavailable"
  | "capabilityUnavailable"
  | "addressUnavailable"
  | "addressNotPinned"
  | "memberUnavailable"
  | "supervisionUnavailable"
  | "requirementUnavailable"
  | "durationUnavailable";

export type RebookPrefillNotice = { code: RebookNoticeCode; requirementId?: string };

export type RebookSourceBooking = {
  provider_id: string;
  service_id: string;
  address_id: string | null;
  family_member_id: string | null;
  supervision_mode: string | null;
  teaching_capability_id: string | null;
  session_duration_min: number | null;
  requirement_selections: unknown;
  notes: string | null;
  teaching_curriculum_code?: string | null;
  teaching_level_code?: string | null;
};

export type RebookCapability = {
  id: string;
  serviceId: string;
  status: string;
  curriculumId?: string | null;
  levelId?: string | null;
};

export type RebookRequirement = {
  id: string;
  fulfillment_mode: string;
  required_during_booking: boolean;
  is_active?: boolean;
};

export type RebookPrefillContext = {
  expectedProviderId: string;
  bookableServiceIds: Set<string>;
  serviceById: Map<string, PackageService & { id: string; category?: { slug?: string | null } | null }>;
  pinnedAddressIds: Set<string>;
  activeFamilyMemberIds: Set<string>;
  capabilities: RebookCapability[];
  bookingRequirements: RebookRequirement[];
};

export type RebookPrefillValues = {
  serviceId?: string;
  capabilityId?: string;
  hours?: number;
  addressId?: string;
  forWhom: string;
  supervisionMode: SupervisionMode | "";
  requirementChoices: Record<string, "customer" | "provider">;
  notes: string;
  curriculumId?: string;
  levelId?: string;
};

export type RebookPrefillResult = {
  values: RebookPrefillValues;
  notices: RebookPrefillNotice[];
};

type RequirementSelection = { requirement_id: string; chosen_by: "customer" | "provider" };

function parseRequirementSelections(raw: unknown): RequirementSelection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const requirement_id = (row as RequirementSelection).requirement_id;
      const chosen_by = (row as RequirementSelection).chosen_by;
      if (typeof requirement_id !== "string") return null;
      if (chosen_by !== "customer" && chosen_by !== "provider") return null;
      return { requirement_id, chosen_by };
    })
    .filter(Boolean) as RequirementSelection[];
}

function hourlyHoursFromMinutes(minutes: number | null | undefined): number | undefined {
  if (minutes == null || !Number.isFinite(minutes)) return undefined;
  const hours = minutes / 60;
  if (hours < 2 || hours > 8 || hours % 2 !== 0) return undefined;
  return hours;
}

export function mapRebookPrefill(
  booking: RebookSourceBooking,
  ctx: RebookPrefillContext,
): RebookPrefillResult {
  const notices: RebookPrefillNotice[] = [];
  const values: RebookPrefillValues = {
    forWhom: "myself",
    supervisionMode: "",
    requirementChoices: {},
    notes: booking.notes?.trim() ?? "",
  };

  if (booking.provider_id !== ctx.expectedProviderId) {
    notices.push({ code: "serviceUnavailable" });
    return { values, notices };
  }

  const service = ctx.serviceById.get(booking.service_id);
  if (!service || !ctx.bookableServiceIds.has(booking.service_id)) {
    notices.push({ code: "serviceUnavailable" });
  } else {
    values.serviceId = booking.service_id;
    const tutoring = service.category?.slug === "tutoring";
    const fixed = isFixedPackage(service);

    if (tutoring) {
      const cap = ctx.capabilities.find(
        (c) => c.id === booking.teaching_capability_id && c.status === "approved",
      );
      if (cap && cap.serviceId === booking.service_id) {
        values.capabilityId = cap.id;
        if (cap.curriculumId) values.curriculumId = cap.curriculumId;
        if (cap.levelId) values.levelId = cap.levelId;
      } else if (booking.teaching_capability_id) {
        notices.push({ code: "capabilityUnavailable" });
      }
    } else if (!fixed) {
      const hours = hourlyHoursFromMinutes(booking.session_duration_min);
      if (hours) values.hours = hours;
      else if (booking.session_duration_min != null) notices.push({ code: "durationUnavailable" });
    }

    if (booking.address_id && ctx.pinnedAddressIds.has(booking.address_id)) {
      values.addressId = booking.address_id;
    } else if (booking.address_id) {
      notices.push(
        ctx.pinnedAddressIds.size ? { code: "addressNotPinned" } : { code: "addressUnavailable" },
      );
    }

    if (booking.family_member_id) {
      if (ctx.activeFamilyMemberIds.has(booking.family_member_id)) {
        values.forWhom = booking.family_member_id;
      } else {
        notices.push({ code: "memberUnavailable" });
      }
    }

    const supervision = booking.supervision_mode;
    if (supervision) {
      if (isSupervisionMode(supervision)) values.supervisionMode = supervision;
      else notices.push({ code: "supervisionUnavailable" });
    }

    const activeEither = ctx.bookingRequirements.filter(
      (r) => r.required_during_booking && r.fulfillment_mode === "either",
    );
    const activeEitherIds = new Set(activeEither.map((r) => r.id));
    for (const row of parseRequirementSelections(booking.requirement_selections)) {
      if (!activeEitherIds.has(row.requirement_id)) {
        notices.push({ code: "requirementUnavailable", requirementId: row.requirement_id });
        continue;
      }
      values.requirementChoices[row.requirement_id] = row.chosen_by;
    }
  }

  return { values, notices };
}
