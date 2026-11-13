import { describe, expect, it } from "vitest";
import { mapRebookPrefill, type RebookPrefillContext, type RebookSourceBooking } from "../rebookPrefill";

const baseBooking: RebookSourceBooking = {
  provider_id: "prov-1",
  service_id: "svc-hourly",
  address_id: "addr-1",
  family_member_id: null,
  supervision_mode: null,
  teaching_capability_id: null,
  session_duration_min: 240,
  requirement_selections: [],
  notes: "same place",
};

function ctx(over: Partial<RebookPrefillContext> = {}): RebookPrefillContext {
  return {
    expectedProviderId: "prov-1",
    bookableServiceIds: new Set(["svc-hourly"]),
    serviceById: new Map([
      [
        "svc-hourly",
        {
          id: "svc-hourly",
          pricing_model: "hourly",
          category: { slug: "babysitting" },
        },
      ],
      [
        "svc-old",
        {
          id: "svc-old",
          pricing_model: "hourly",
          category: { slug: "babysitting" },
        },
      ],
      [
        "svc-tutor",
        {
          id: "svc-tutor",
          pricing_model: "hourly",
          category: { slug: "tutoring" },
        },
      ],
    ]),
    pinnedAddressIds: new Set(["addr-1"]),
    activeFamilyMemberIds: new Set(["child-1"]),
    capabilities: [
      { id: "cap-1", serviceId: "svc-tutor", status: "approved", curriculumId: "cur-1", levelId: "lvl-1" },
    ],
    bookingRequirements: [],
    ...over,
  };
}

describe("mapRebookPrefill", () => {
  it("prefills valid hourly babysitting fields and never carries time or promo", () => {
    const result = mapRebookPrefill(baseBooking, ctx());
    expect(result.values).toMatchObject({
      serviceId: "svc-hourly",
      hours: 4,
      addressId: "addr-1",
      forWhom: "myself",
      notes: "same place",
    });
    expect(result.notices).toEqual([]);
  });

  it("drops service when it is no longer bookable", () => {
    const result = mapRebookPrefill(
      { ...baseBooking, service_id: "svc-old" },
      ctx({ bookableServiceIds: new Set(["svc-hourly"]) }),
    );
    expect(result.values.serviceId).toBeUndefined();
    expect(result.notices.some((n) => n.code === "serviceUnavailable")).toBe(true);
  });

  it("drops suspended tutoring capability", () => {
    const result = mapRebookPrefill(
      {
        ...baseBooking,
        service_id: "svc-tutor",
        teaching_capability_id: "cap-gone",
      },
      ctx({
        bookableServiceIds: new Set(["svc-tutor"]),
        capabilities: [],
      }),
    );
    expect(result.values.capabilityId).toBeUndefined();
    expect(result.notices).toContainEqual({ code: "capabilityUnavailable" });
  });

  it("keeps approved capability and education ids", () => {
    const result = mapRebookPrefill(
      {
        ...baseBooking,
        service_id: "svc-tutor",
        teaching_capability_id: "cap-1",
      },
      ctx({ bookableServiceIds: new Set(["svc-tutor"]) }),
    );
    expect(result.values).toMatchObject({
      serviceId: "svc-tutor",
      capabilityId: "cap-1",
      curriculumId: "cur-1",
      levelId: "lvl-1",
    });
  });

  it("filters requirement choices to active either requirements", () => {
    const result = mapRebookPrefill(
      {
        ...baseBooking,
        requirement_selections: [
          { requirement_id: "req-active", chosen_by: "provider" },
          { requirement_id: "req-stale", chosen_by: "customer" },
        ],
      },
      ctx({
        bookingRequirements: [
          {
            id: "req-active",
            fulfillment_mode: "either",
            required_during_booking: true,
          },
        ],
      }),
    );
    expect(result.values.requirementChoices).toEqual({ "req-active": "provider" });
    expect(result.notices.some((n) => n.code === "requirementUnavailable")).toBe(true);
  });
});
