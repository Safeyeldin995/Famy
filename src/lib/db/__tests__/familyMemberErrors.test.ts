import { describe, expect, it } from "vitest";
import { familyMemberErrorMessageKey } from "@/lib/db/familyMemberErrors";
import {
  emptyFamilyMemberFormValue,
  familyMemberFormValueToInput,
} from "@/components/famio/FamilyMemberForm";

describe("familyMemberErrorMessageKey", () => {
  it("maps phone format trigger errors to invalidPhone", () => {
    expect(
      familyMemberErrorMessageKey({
        code: "23514",
        message: "Phone number must be in a valid international format.",
      }),
    ).toBe("validation.invalidPhone");
  });

  it("maps future DOB trigger errors", () => {
    expect(
      familyMemberErrorMessageKey({
        code: "23514",
        message: "Date of birth cannot be in the future.",
      }),
    ).toBe("familyMembers.dobFuture");
  });
});

describe("familyMemberFormValueToInput", () => {
  it("normalizes optional local phone to E.164 for persistence", () => {
    const input = familyMemberFormValueToInput({
      ...emptyFamilyMemberFormValue(),
      fullName: "Layla",
      relationship: "daughter",
      dateOfBirth: "2020-01-15",
      phone: "01012345678",
    });
    expect(input.phone).toBe("+201012345678");
  });

  it("clears relationship_other when relationship is not other", () => {
    const input = familyMemberFormValueToInput({
      ...emptyFamilyMemberFormValue(),
      fullName: "Layla",
      relationship: "daughter",
      dateOfBirth: "2020-01-15",
      relationshipOther: "should drop",
    });
    expect(input.relationship_other).toBeNull();
  });
});
