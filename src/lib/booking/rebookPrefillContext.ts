import {
  mapRebookPrefill,
  type RebookPrefillContext,
  type RebookPrefillResult,
  type RebookSourceBooking,
} from "./rebookPrefill";

export function buildRebookPrefillContext(input: {
  providerId: string;
  services: Array<{
    service: {
      id: string;
      pricing_model?: string | null;
      duration_min?: number | null;
      category?: { slug?: string | null } | null;
    };
  }>;
  bookableServiceIds: Set<string> | undefined;
  addresses: Array<{ id: string; lat?: number | null; lng?: number | null }>;
  familyMembers: Array<{ id: string }>;
  capabilities: Array<{
    id: string;
    serviceId: string;
    status: string;
    curriculumId?: string | null;
    levelId?: string | null;
  }>;
  bookingRequirements: Array<{
    id: string;
    fulfillment_mode: string;
    required_during_booking: boolean;
    is_active?: boolean;
  }>;
}): RebookPrefillContext {
  const serviceById = new Map(
    input.services.map((row) => [
      row.service.id,
      {
        id: row.service.id,
        pricing_model: row.service.pricing_model,
        duration_min: row.service.duration_min,
        category: row.service.category,
      },
    ]),
  );
  return {
    expectedProviderId: input.providerId,
    bookableServiceIds: input.bookableServiceIds ?? new Set(input.services.map((s) => s.service.id)),
    serviceById,
    pinnedAddressIds: new Set(
      input.addresses.filter((a) => a.lat != null && a.lng != null).map((a) => a.id),
    ),
    activeFamilyMemberIds: new Set(input.familyMembers.map((m) => m.id)),
    capabilities: input.capabilities,
    bookingRequirements: input.bookingRequirements,
  };
}

export function applyRebookPrefill(
  booking: RebookSourceBooking | null | undefined,
  ctx: RebookPrefillContext,
): RebookPrefillResult | null {
  if (!booking) return null;
  return mapRebookPrefill(booking, ctx);
}
