import { describe, expect, it } from "vitest";
import { buildBookingRequest, buildBookingQuote } from "../bookingRequest";

const choices = {
  providerId: "provider-fixture",
  serviceId: "hourly",
  addressId: "address-fixture",
  forWhom: "child-fixture",
  start: new Date("2026-10-12T07:00:00Z"),
  end: new Date("2026-10-12T11:00:00Z"),
  promoStatus: "idle",
  appliedPromoId: null,
  notes: "",
  eitherRequirements: [],
  requirementChoices: {},
  selectedCapability: null,
};
const expected = {
  provider_id: "provider-fixture",
  service_id: "hourly",
  address_id: "address-fixture",
  family_member_id: "child-fixture",
  start_at: "2026-10-12T07:00:00.000Z",
  end_at: "2026-10-12T11:00:00.000Z",
  promo_code_id: null,
  notes: null,
  requirement_selections: [],
  teaching_capability_id: null,
  teaching_subject_code: null,
  teaching_curriculum_code: null,
  teaching_level_code: null,
};
const quote = {
  service: { pricing_model: "hourly" },
  rate: 250,
  hours: 4,
  capability: null,
  fee: 20,
  vatPercent: 14,
  requirements: [],
  requirementChoices: {},
  travelFee: 30,
  promoDiscount: 0,
};

describe("original booking payload and quote contracts", () => {
  it("pins hourly babysitting", () => {
    expect(buildBookingRequest(choices)).toEqual(expected);
    expect(buildBookingQuote(quote)).toEqual({
      tutoringQuote: null,
      subtotal: 1000,
      fee: 20,
      vat: 140,
      extrasTotal: 0,
      travelFee: 30,
      total: 1190,
    });
  });
  it.each([
    ["full-day", 480, null, "2026-10-12T07:00:00Z", "2026-10-12T15:00:00Z", 1400, 1646],
    ["overnight", 360, "18:00", "2026-10-12T15:00:00Z", "2026-10-12T21:00:00Z", 900, 1076],
  ] as const)(
    "pins %s without multiplying the package rate",
    (serviceId, duration_min, fixed_start_time, start, end, rate, total) => {
      expect(
        buildBookingRequest({ ...choices, serviceId, start: new Date(start), end: new Date(end) }),
      ).toEqual({
        ...expected,
        service_id: serviceId,
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
      });
      expect(
        buildBookingQuote({
          ...quote,
          service: { pricing_model: "fixed", duration_min, fixed_start_time },
          hours: duration_min / 60,
          rate,
        }),
      ).toEqual({
        tutoringQuote: null,
        subtotal: rate,
        fee: 20,
        vat: serviceId === "full-day" ? 196 : 126,
        extrasTotal: 0,
        travelFee: 30,
        total,
      });
    },
  );
  it("pins tutoring codes and the session quote", () => {
    const capability = {
      id: "capability-fixture",
      subjectCode: "math",
      curriculumCode: "national",
      levelCode: "grade-4",
      durationMin: 90,
      price: 450,
    };
    expect(
      buildBookingRequest({
        ...choices,
        forWhom: "myself",
        serviceId: "tutoring",
        selectedCapability: capability,
        end: new Date("2026-10-12T08:30:00Z"),
      }),
    ).toEqual({
      ...expected,
      family_member_id: null,
      service_id: "tutoring",
      end_at: "2026-10-12T08:30:00.000Z",
      teaching_capability_id: capability.id,
      teaching_subject_code: "math",
      teaching_curriculum_code: "national",
      teaching_level_code: "grade-4",
    });
    expect(buildBookingQuote({ ...quote, capability }).total).toBe(563);
    expect(buildBookingQuote({ ...quote, capability }).subtotal).toBe(450);
  });
  it("pins applied promo, preserving notes and ignoring unapplied promo IDs", () => {
    expect(
      buildBookingRequest({
        ...choices,
        promoStatus: "applied",
        appliedPromoId: "promo-fixture",
        notes: "Keep this note",
      }),
    ).toEqual({ ...expected, promo_code_id: "promo-fixture", notes: "Keep this note" });
    expect(buildBookingRequest({ ...choices, appliedPromoId: "promo-fixture" })).toEqual(expected);
    expect(buildBookingQuote({ ...quote, promoDiscount: 100 }).total).toBe(1090);
  });
  it("pins ordered either selections and requirement extras", () => {
    const requirementChoices = { r2: "provider", r1: "customer" } as const;
    expect(
      buildBookingRequest({
        ...choices,
        eitherRequirements: [{ id: "r1" }, { id: "r2" }],
        requirementChoices,
      }),
    ).toEqual({
      ...expected,
      requirement_selections: [
        { requirement_id: "r1", chosen_by: "customer" },
        { requirement_id: "r2", chosen_by: "provider" },
      ],
    });
    expect(
      buildBookingQuote({
        ...quote,
        requirementChoices,
        requirements: [
          { id: "r1", fulfillment_mode: "either", provider_extra_fee: 100 },
          { id: "r2", fulfillment_mode: "either", provider_extra_fee: "70" },
          { id: "r3", fulfillment_mode: "provider", provider_extra_fee: 30 },
          { id: "r4", fulfillment_mode: "customer", provider_extra_fee: 50 },
        ],
      }),
    ).toEqual({
      tutoringQuote: null,
      subtotal: 1000,
      fee: 20,
      vat: 140,
      extrasTotal: 100,
      travelFee: 30,
      total: 1290,
    });
  });
});
