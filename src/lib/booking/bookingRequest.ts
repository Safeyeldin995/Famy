import { bookingFamilyMemberId } from "./babysittingRecipient";
import { serviceQuote, type PackageService } from "@/lib/pricing/servicePackages";
import { tutoringSessionQuote } from "@/lib/tutoring/teachingCapabilities";

type Capability = {
  id: string;
  subjectCode: string;
  curriculumCode: string;
  levelCode: string;
};

/** The existing create-booking payload, before its idempotency key is attached. */
export function buildBookingRequest(choices: {
  providerId: string;
  serviceId: string;
  addressId: string;
  forWhom: string;
  start: Date;
  end: Date;
  promoStatus: string;
  appliedPromoId: string | null;
  notes: string;
  eitherRequirements: { id: string }[];
  requirementChoices: Record<string, "customer" | "provider">;
  selectedCapability: Capability | null;
}) {
  return {
    provider_id: choices.providerId,
    service_id: choices.serviceId,
    address_id: choices.addressId,
    family_member_id: bookingFamilyMemberId(choices.forWhom),
    start_at: choices.start.toISOString(),
    end_at: choices.end.toISOString(),
    promo_code_id: choices.promoStatus === "applied" ? choices.appliedPromoId : null,
    notes: choices.notes || null,
    requirement_selections: choices.eitherRequirements.map((r) => ({
      requirement_id: r.id,
      chosen_by: choices.requirementChoices[r.id],
    })),
    teaching_capability_id: choices.selectedCapability?.id ?? null,
    teaching_subject_code: choices.selectedCapability?.subjectCode ?? null,
    teaching_curriculum_code: choices.selectedCapability?.curriculumCode ?? null,
    teaching_level_code: choices.selectedCapability?.levelCode ?? null,
  };
}

/** Same quote inputs and arithmetic as the original booking route. Server remains authoritative. */
export function buildBookingQuote(input: {
  service: PackageService | null | undefined;
  rate: number;
  hours: number;
  capability: { durationMin: number; price: number } | null;
  fee: number;
  vatPercent: number;
  requirements: { id: string; fulfillment_mode: string; provider_extra_fee: number | string }[];
  requirementChoices: Record<string, "customer" | "provider">;
  travelFee: number;
  promoDiscount: number;
}) {
  const tutoringQuote = input.capability
    ? tutoringSessionQuote(input.capability.durationMin, input.capability.price)
    : null;
  const subtotal = tutoringQuote
    ? tutoringQuote.subtotal
    : serviceQuote(input.service, input.rate, input.hours).subtotal;
  const fee = input.fee;
  const vat = Math.round(subtotal * (input.vatPercent / 100));
  const extrasTotal = input.requirements.reduce((sum, r) => {
    if (r.fulfillment_mode === "provider") return sum + Number(r.provider_extra_fee);
    if (r.fulfillment_mode === "either" && input.requirementChoices[r.id] === "provider")
      return sum + Number(r.provider_extra_fee);
    return sum;
  }, 0);
  const travelFee = input.travelFee;
  const total = Math.max(0, subtotal + fee + vat + extrasTotal + travelFee - input.promoDiscount);
  return { tutoringQuote, subtotal, fee, vat, extrasTotal, travelFee, total };
}
