import { buildBookingQuote } from "@/lib/booking/bookingRequest";

export type OnlineLessonBilling = {
  platform_fee: number;
  vat_percent: number;
};

/** Same total arithmetic as `buildBookingQuote` / `tg_validate_booking_service` for online tutoring. */
export function onlineLessonRequestTotal(
  capability: { durationMin: number; price: number },
  billing: OnlineLessonBilling,
  promoDiscount = 0,
): number {
  return buildBookingQuote({
    service: null,
    rate: 0,
    hours: 0,
    capability,
    fee: billing.platform_fee,
    vatPercent: billing.vat_percent,
    requirements: [],
    requirementChoices: {},
    travelFee: 0,
    promoDiscount,
  }).total;
}