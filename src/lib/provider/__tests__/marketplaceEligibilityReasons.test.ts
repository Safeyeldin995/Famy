import { describe, expect, it } from "vitest";
import {
  dedupeEligibilityReasons,
  mapMarketplaceEligibilityFailureReason,
  marketplaceEligibilityStatus,
} from "@/lib/provider/marketplaceEligibilityReasons";

describe("marketplaceEligibilityReasons", () => {
  it("maps known RPC strings to i18n keys and actions", () => {
    expect(mapMarketplaceEligibilityFailureReason("Provider has no valid availability")).toEqual({
      owner: "provider",
      i18nKey: "pro.profile.eligibilityReasons.noAvailability",
      action: { kind: "link", path: "/pro/setup/hours" },
    });
    expect(
      mapMarketplaceEligibilityFailureReason(
        "Provider price is missing or outside Admin limits",
        "svc-1",
      ),
    ).toEqual({
      owner: "provider",
      i18nKey: "pro.profile.eligibilityReasons.invalidPrice",
      action: { kind: "service", serviceId: "svc-1" },
    });
  });

  it("deduplicates repeated reasons across services", () => {
    const rows = dedupeEligibilityReasons([
      {
        service_id: "svc-1",
        failure_reasons: ["Provider has no valid availability"],
      },
      {
        service_id: "svc-2",
        failure_reasons: ["Provider has no valid availability"],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.serviceIds.sort()).toEqual(["svc-1", "svc-2"]);
  });

  it("groups price problems across services and lists each affected service once", () => {
    const reason = "Provider price is missing or outside Admin limits";
    const rows = dedupeEligibilityReasons([
      { service_id: "cleaning", failure_reasons: [reason, reason] },
      { service_id: "babysitting", failure_reasons: [reason] },
      { service_id: "cleaning", failure_reasons: [reason] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.serviceIds).toEqual(["cleaning", "babysitting"]);
  });

  it("groups tutoring prices and targets the affected teaching service", () => {
    const reason = "No approved teaching subject with a valid session price";
    const rows = dedupeEligibilityReasons([
      { service_id: "school", failure_reasons: [reason] },
      { service_id: "language", failure_reasons: [reason] },
      { service_id: "homework", failure_reasons: [reason] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.serviceIds).toEqual(["school", "language", "homework"]);
    expect(rows[0]?.mapped).toEqual({
      owner: "provider",
      i18nKey: "pro.profile.eligibilityReasons.teachingPrice",
      action: { kind: "link", path: "/pro/setup/subjects" },
    });
  });

  it("keeps coverage enablement with Famy without linking back to the old wizard", () => {
    const reason = "Active Provider and Service zone coverage is missing";
    expect(mapMarketplaceEligibilityFailureReason(reason, "school", 0)).toEqual({
      owner: "famy",
      i18nKey: "providerProfileV3.coverageReview",
      action: { kind: "info" },
    });
    expect(mapMarketplaceEligibilityFailureReason(reason, "school", 2)).toEqual({
      owner: "famy",
      i18nKey: "pro.profile.eligibilityReasons.zoneUnavailable",
      action: { kind: "info" },
    });
  });

  it("counts unique problems as steps, rather than repeated service failures", () => {
    const rows = ["school", "language", "homework"].map((service_id) => ({
      service_id,
      is_eligible: false,
      failure_reasons: [
        "No approved teaching subject with a valid session price",
        "Active Provider and Service zone coverage is missing",
      ],
    }));
    expect(marketplaceEligibilityStatus(rows, 2)).toEqual({
      visible: false,
      i18nKey: "pro.profile.notVisibleToCustomers",
      stepsLeft: 1,
    });
    expect(
      marketplaceEligibilityStatus(
        [{ service_id: "cleaning", is_eligible: true, failure_reasons: [] }, ...rows],
        2,
      ),
    ).toEqual({
      visible: true,
      i18nKey: "pro.profile.visibleToCustomers",
      stepsLeft: 0,
    });
  });
});

it("classifies every known reason and fallback with an owner and a provider action", () => {
  const reasons = ["Provider has no valid availability", "Active Provider and Service zone coverage is missing", "Provider price is missing or outside Admin limits", "No approved teaching subject with a valid session price", "Provider-service relationship is not approved", "Provider is not verified or onboarding is not approved", "Provider account is inactive, not approved, deleted, or in vacation mode", "Provider is not verified", "Mandatory Provider requirements are incomplete", "Required evidence is missing or not approved", "Service is inactive or hidden from Customers", "Babysitting maximum children or age-group capabilities are not declared", "Unknown reason", "Unknown price reason"];
  for (const reason of reasons) {
    const mapped = mapMarketplaceEligibilityFailureReason(reason, "service");
    expect(["provider", "famy"]).toContain(mapped.owner);
    if (mapped.owner === "provider") expect(mapped.action.kind).not.toBe("info");
  }
});
it("excludes service and subject reviews from the provider action count", () => {
  const rows = [{service_id:"tutor", is_eligible:false, failure_reasons:["No approved teaching subject with a valid session price", "Provider-service relationship is not approved", "Provider has no valid availability"]}];
  expect(marketplaceEligibilityStatus(rows, 1, new Set(["tutor"])).stepsLeft).toBe(1);
  expect(mapMarketplaceEligibilityFailureReason(rows[0].failure_reasons[0], "tutor", 1, true)).toEqual({owner:"famy", i18nKey:"providerProfileV3.subjectPending", action:{kind:"info"}});
});
