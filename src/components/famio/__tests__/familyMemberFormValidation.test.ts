import { describe, expect, it } from "vitest";
import { emptyFamilyMemberFormValue } from "@/components/famio/FamilyMemberForm";
import { normalizePhone } from "@/lib/otp/OtpService";

const PHONE_RE = /^\+\d{8,15}$/;

function isValidOptionalPhone(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return PHONE_RE.test(normalizePhone(trimmed));
}

/** Mirrors FamilyMemberForm client validation (kept in sync for unit tests). */
function isFamilyMemberFormValid(
  value: ReturnType<typeof emptyFamilyMemberFormValue>,
  today: string,
) {
  const dobValid = !!value.dateOfBirth && value.dateOfBirth <= today;
  const relationshipOtherValid =
    value.relationship !== "other" || value.relationshipOther.trim().length > 0;
  const emergencyValid =
    !value.emergencyContactName.trim() || value.emergencyContactPhone.trim().length > 0;
  return (
    value.fullName.trim().length > 0 &&
    !!value.relationship &&
    relationshipOtherValid &&
    dobValid &&
    emergencyValid &&
    isValidOptionalPhone(value.phone) &&
    isValidOptionalPhone(value.emergencyContactPhone)
  );
}

describe("family member form validation", () => {
  const today = "2026-09-30";

  it("rejects empty required fields", () => {
    expect(isFamilyMemberFormValid(emptyFamilyMemberFormValue(), today)).toBe(false);
  });

  it("accepts a minimal valid child profile", () => {
    expect(
      isFamilyMemberFormValid(
        {
          ...emptyFamilyMemberFormValue(),
          fullName: "Layla Ahmed",
          relationship: "daughter",
          dateOfBirth: "2020-04-01",
        },
        today,
      ),
    ).toBe(true);
  });

  it("rejects emergency name without phone", () => {
    expect(
      isFamilyMemberFormValid(
        {
          ...emptyFamilyMemberFormValue(),
          fullName: "Layla",
          relationship: "daughter",
          dateOfBirth: "2020-04-01",
          emergencyContactName: "Mona",
        },
        today,
      ),
    ).toBe(false);
  });
});
