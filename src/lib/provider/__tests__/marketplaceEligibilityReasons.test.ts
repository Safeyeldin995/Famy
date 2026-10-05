import { describe, expect, it } from "vitest";
import {
  dedupeEligibilityReasons,
  mapMarketplaceEligibilityFailureReason,
  marketplaceEligibilityStatus,
} from "@/lib/provider/marketplaceEligibilityReasons";

describe("marketplaceEligibilityReasons", () => {
  it("maps known RPC strings to i18n keys and actions", () => {
    expect(mapMarketplaceEligibilityFailureReason("Provider has no valid availability")).toEqual({
      i18nKey: "pro.profile.eligibilityReasons.noAvailability",
      action: { kind: "link", path: "/pro/availability" },
    });
    expect(
      mapMarketplaceEligibilityFailureReason(
        "Provider price is missing or outside Admin limits",
        "svc-1",
      ),
    ).toEqual({
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
      i18nKey: "pro.profile.eligibilityReasons.teachingPrice",
      action: { kind: "service", serviceId: "school" },
    });
  });

  it("sends providers with no coverage rows to onboarding, and otherwise shows info without a link", () => {
    const reason = "Active Provider and Service zone coverage is missing";
    expect(mapMarketplaceEligibilityFailureReason(reason, "school", 0)).toEqual({
      i18nKey: "pro.profile.eligibilityReasons.missingZone",
      action: { kind: "link", path: "/pro/onboarding" },
    });
    expect(mapMarketplaceEligibilityFailureReason(reason, "school", 2)).toEqual({
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
      stepsLeft: 2,
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
