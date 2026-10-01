import { describe, expect, it } from "vitest";
import {
  dedupeEligibilityReasons,
  mapMarketplaceEligibilityFailureReason,
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
});
