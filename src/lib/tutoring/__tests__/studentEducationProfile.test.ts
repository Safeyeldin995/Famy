import { describe, expect, it } from "vitest";
import { resolveStudentEducationProfile } from "../studentEducationProfile";

describe("student education profile resolution", () => {
  it("reads the customer self profile", () => {
    const result = resolveStudentEducationProfile({
      forWhom: "myself",
      customerProfile: {
        education_curriculum_id: "cur-self",
        education_level_id: "lvl-self",
      } as const,
      customerFullName: "Omar Hassan",
      familyMembers: [],
    });
    expect(result.educationCurriculumId).toBe("cur-self");
    expect(result.educationLevelId).toBe("lvl-self");
    expect(result.studentFirstName).toBe("Omar");
  });

  it("reads a family member profile and first name", () => {
    const result = resolveStudentEducationProfile({
      forWhom: "member-1",
      customerProfile: null,
      familyMembers: [
        {
          id: "member-1",
          full_name: "Layla Ahmed",
          education_curriculum_id: "cur-child",
          education_level_id: "lvl-child",
        },
      ],
    });
    expect(result.educationCurriculumId).toBe("cur-child");
    expect(result.educationLevelId).toBe("lvl-child");
    expect(result.studentFirstName).toBe("Layla");
    expect(result.familyMemberId).toBe("member-1");
  });
});
