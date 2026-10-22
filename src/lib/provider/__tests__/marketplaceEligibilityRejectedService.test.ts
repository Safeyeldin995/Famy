import { describe, expect, it } from "vitest";
import { mapMarketplaceEligibilityFailureReason } from "../marketplaceEligibilityReasons";

describe("mapMarketplaceEligibilityFailureReason rejected services", () => {
  it("maps pending and rejected provider-service reasons separately", () => {
    expect(
      mapMarketplaceEligibilityFailureReason(
        "Provider-service relationship is pending admin approval",
      ).i18nKey,
    ).toBe("pro.profile.eligibilityReasons.servicePending");
    expect(
      mapMarketplaceEligibilityFailureReason(
        "Provider-service relationship was rejected by admin",
        "svc-1",
      ),
    ).toMatchObject({
      i18nKey: "pro.profile.eligibilityReasons.serviceRejected",
      action: { kind: "service", serviceId: "svc-1" },
    });
  });
});
