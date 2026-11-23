import { describe, expect, it } from "vitest";
import { familyMemberIsMinor, requiresOnlineGuardianConsent } from "@/lib/online/guardianConsent";

describe("guardianConsent", () => {
  it("treats under-18 family members as minors", () => {
    expect(familyMemberIsMinor("2012-06-01", "2026-11-23")).toBe(true);
    expect(familyMemberIsMinor("2000-06-01", "2026-11-23")).toBe(false);
  });

  it("requires consent for online child bookings only", () => {
    expect(
      requiresOnlineGuardianConsent({
        serviceMode: "online",
        forWhom: "child-id",
        familyMemberDateOfBirth: "2014-01-01",
      }),
    ).toBe(true);
    expect(
      requiresOnlineGuardianConsent({
        serviceMode: "in_person",
        forWhom: "child-id",
        familyMemberDateOfBirth: "2014-01-01",
      }),
    ).toBe(false);
    expect(
      requiresOnlineGuardianConsent({
        serviceMode: "online",
        forWhom: "myself",
        familyMemberDateOfBirth: null,
      }),
    ).toBe(false);
  });
});