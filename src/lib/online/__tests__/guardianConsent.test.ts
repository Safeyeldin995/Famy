import { describe, expect, it } from "vitest";
import { requiresOnlineGuardianConsent } from "@/lib/online/guardianConsent";

describe("guardianConsent", () => {
  it("never requires guardian consent for online bookings (12+ self-book)", () => {
    expect(
      requiresOnlineGuardianConsent({
        serviceMode: "online",
        forWhom: "family-member",
        familyMemberDateOfBirth: "2012-06-01",
      }),
    ).toBe(false);
  });
});