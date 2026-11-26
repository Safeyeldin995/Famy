import { describe, expect, it } from "vitest";
import {
  isTeachingLevelLabelStyle,
  nextSchoolGradeCode,
  schoolGradeNumber,
  teachingLevelLabel,
} from "../teachingLevelLabels";

describe("teaching level labels", () => {
  it("writes Egyptian grades the way parents say them", () => {
    expect(teachingLevelLabel({ levelCode: "kg", style: "eg", lang: "ar" })).toBe("كي جي");
    expect(teachingLevelLabel({ levelCode: "g3", style: "eg", lang: "ar" })).toBe("3 ابتدائي");
    expect(teachingLevelLabel({ levelCode: "g8", style: "eg", lang: "ar" })).toBe("2 إعدادي");
    expect(teachingLevelLabel({ levelCode: "g12", style: "eg", lang: "ar" })).toBe("3 ثانوي");
    expect(teachingLevelLabel({ levelCode: "g11", style: "eg", lang: "en" })).toBe("Secondary 2");
  });

  it("uses Year N for British (Year 2 = grade 1) and Grade N for American", () => {
    expect(teachingLevelLabel({ levelCode: "kg", style: "british_year", lang: "ar" })).toBe(
      "Year 1",
    );
    expect(teachingLevelLabel({ levelCode: "g1", style: "british_year", lang: "ar" })).toBe(
      "Year 2",
    );
    expect(teachingLevelLabel({ levelCode: "g4", style: "american_grade", lang: "en" })).toBe(
      "Grade 4",
    );
    expect(teachingLevelLabel({ levelCode: "kg", style: "american_grade", lang: "en" })).toBe("KG");
  });

  it("groups IB grades by programme", () => {
    expect(teachingLevelLabel({ levelCode: "g5", style: "ib_programme", lang: "en" })).toBe(
      "PYP · Grade 5",
    );
    expect(teachingLevelLabel({ levelCode: "g7", style: "ib_programme", lang: "en" })).toBe(
      "MYP · Grade 7",
    );
    expect(teachingLevelLabel({ levelCode: "g11", style: "ib_programme", lang: "en" })).toBe(
      "DP · Grade 11",
    );
  });

  it("falls back to the level's own name for skills and plain systems", () => {
    expect(
      teachingLevelLabel({
        levelCode: "skill_beginner",
        style: "eg",
        lang: "ar",
        fallbackName: "مبتدئ",
      }),
    ).toBe("مبتدئ");
    expect(
      teachingLevelLabel({
        levelCode: "g4",
        style: "plain",
        lang: "ar",
        fallbackName: "الصف الرابع",
      }),
    ).toBe("الصف الرابع");
    expect(
      teachingLevelLabel({ levelCode: "g4", style: "unknown", lang: "ar", fallbackName: "x" }),
    ).toBe("x");
  });

  it("moves grades up one, except the last grade and skills", () => {
    expect(nextSchoolGradeCode("kg")).toBe("g1");
    expect(nextSchoolGradeCode("g4")).toBe("g5");
    expect(nextSchoolGradeCode("g11")).toBe("g12");
    expect(nextSchoolGradeCode("g12")).toBeNull();
    expect(nextSchoolGradeCode("skill_beginner")).toBeNull();
    expect(schoolGradeNumber("g13")).toBeNull();
    expect(isTeachingLevelLabelStyle("british_year")).toBe(true);
    expect(isTeachingLevelLabelStyle("nope")).toBe(false);
  });
});
