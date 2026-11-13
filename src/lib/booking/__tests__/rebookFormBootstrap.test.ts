import { describe, expect, it } from "vitest";
import {
  buildRebookFormInitial,
  computeRebookFormBootstrap,
  rebookBootstrapQueriesLoading,
} from "../rebookFormBootstrap";
import type { RebookPrefillResult } from "../rebookPrefill";

const hourlyService = {
  id: "svc-hourly",
  pricing_model: "hourly",
  duration_min: 60,
  category: { slug: "babysitting" },
};

describe("rebookFormBootstrap", () => {
  it("reports loading until bookable services and members are ready (cached rebook)", () => {
    expect(
      rebookBootstrapQueriesLoading({
        rebookFrom: "bid-1",
        bookingLoading: false,
        bookingSuccess: true,
        servicesReady: true,
        addressesLoading: false,
        membersLoading: false,
        capsLoading: false,
        requirementsLoading: false,
        bookableLoading: true,
      }),
    ).toBe(true);
    expect(
      rebookBootstrapQueriesLoading({
        rebookFrom: "bid-1",
        bookingLoading: false,
        bookingSuccess: true,
        servicesReady: true,
        addressesLoading: false,
        membersLoading: false,
        capsLoading: false,
        requirementsLoading: false,
        bookableLoading: false,
      }),
    ).toBe(false);
  });

  it("builds seeded initial state for child, address, tutoring capability, and supervision", () => {
    const result: RebookPrefillResult = {
      notices: [],
      values: {
        serviceId: "svc-tutor",
        capabilityId: "cap-1",
        hours: 2,
        addressId: "addr-other",
        forWhom: "child-1",
        supervisionMode: "adult_present",
        notes: "ملاحظة",
        requirementChoices: {},
        curriculumId: "cur-1",
        levelId: "lvl-1",
      },
    };
    const initial = buildRebookFormInitial(
      result,
      {
        provider_id: "p1",
        service_id: "svc-tutor",
        start_at: "",
        end_at: "",
        address_id: "addr-other",
        family_member_id: "child-1",
        supervision_mode: "adult_present",
        teaching_capability_id: "cap-1",
        session_duration_min: 120,
        requirement_selections: null,
        notes: "ملاحظة",
      },
      "addr-default",
    );
    expect(initial.addressId).toBe("addr-other");
    expect(initial.forWhom).toBe("child-1");
    expect(initial.capabilityId).toBe("cap-1");
    expect(initial.supervisionMode).toBe("adult_present");
    expect(initial.seededFields.has("forWhom")).toBe(true);
    expect(initial.forWhom).toBe("child-1");
    expect(initial.seededFields.has("addressId")).toBe(true);
    expect(initial.seededFields.has("capabilityId")).toBe(true);
    expect(initial.seededFields.has("supervisionMode")).toBe(true);
    expect(initial.seededFields.has("education")).toBe(true);
  });

  it("computes bootstrap from bookable map (not all approved services)", () => {
    const initial = computeRebookFormBootstrap({
      rebookFrom: "bid-2",
      providerId: "prov-1",
      booking: {
        provider_id: "prov-1",
        service_id: "svc-hourly",
        start_at: "2026-01-01T10:00:00Z",
        end_at: "2026-01-01T14:00:00Z",
        address_id: "addr-b",
        family_member_id: "fm-1",
        supervision_mode: "cameras",
        teaching_capability_id: null,
        session_duration_min: null,
        requirement_selections: null,
        notes: "",
      },
      services: [{ service: hourlyService }],
      bookableServiceIds: new Set(["svc-hourly"]),
      addresses: [{ id: "addr-b", lat: 30, lng: 31 }],
      familyMembers: [{ id: "fm-1" }],
      capabilities: [],
      bookingRequirements: [],
      fallbackAddressId: "addr-a",
    });
    expect(initial?.serviceId).toBe("svc-hourly");
    expect(initial?.addressId).toBe("addr-b");
    expect(initial?.forWhom).toBe("fm-1");
    expect(initial?.supervisionMode).toBe("cameras");
  });
});
