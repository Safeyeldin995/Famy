import { describe, expect, it } from "vitest";
import type { TeachingCapabilityOption } from "@/lib/tutoring/teachingCapabilities";
import {
  approvedCapabilitiesForService,
  capabilitiesMatchingPick,
  capabilityPickFromCapability,
  coerceCapabilityPick,
  curriculumOptionsFromCapabilities,
  durationOptionsFromCapabilityPick,
  levelOptionsFromCapabilities,
  soleOptionValue,
  subjectOptionsFromCapabilities,
} from "@/lib/tutoring/providerCapabilityCascade";
import { TEACHING_CURRICULUM_NA_CODE } from "@/lib/tutoring/lessonServices";

function cap(partial: Partial<TeachingCapabilityOption> & { id: string }): TeachingCapabilityOption {
  return {
    providerId: "p1",
    serviceId: "svc",
    curriculumId: "cur-eg",
    levelId: "g10",
    subjectCode: "math",
    subjectNameEn: "Math",
    subjectNameAr: "رياضيات",
    curriculumCode: "eg_national_ar",
    curriculumNameEn: "Egyptian",
    curriculumNameAr: "مصري",
    levelCode: "g10",
    levelNameEn: "Grade 10",
    levelNameAr: "الصف العاشر",
    durationMin: 60,
    price: 400,
    status: "approved",
    maxSessionDurationMin: 120,
    ...partial,
  };
}

describe("providerCapabilityCascade", () => {
  const caps = [
    cap({ id: "1", subjectCode: "math", curriculumId: "cur-eg", levelId: "g10" }),
    cap({
      id: "2",
      subjectCode: "math",
      curriculumId: "cur-eg",
      levelId: "g11",
      levelCode: "g11",
      levelNameEn: "Grade 11",
      levelNameAr: "الصف الحادي عشر",
    }),
    cap({
      id: "3",
      subjectCode: "physics",
      subjectNameEn: "Physics",
      subjectNameAr: "فيزياء",
      curriculumId: "cur-brit",
      curriculumCode: "british",
      curriculumNameEn: "British",
      curriculumNameAr: "بريطاني",
      levelId: "g12",
      levelCode: "g12",
      levelNameEn: "Grade 12",
      levelNameAr: "الصف الثاني عشر",
    }),
  ];

  it("filters subjects and curricula to provider capabilities", () => {
    expect(subjectOptionsFromCapabilities(caps, "en").map((row) => row.value)).toEqual([
      "math",
      "physics",
    ]);
    expect(curriculumOptionsFromCapabilities(caps, "math", "en").map((row) => row.value)).toEqual([
      "cur-eg",
    ]);
    expect(levelOptionsFromCapabilities(caps, "math", "cur-eg", "en").map((row) => row.value)).toEqual(
      ["g10", "g11"],
    );
  });

  it("preselects when only one subject exists", () => {
    const one = caps.filter((row) => row.subjectCode === "physics");
    expect(
      coerceCapabilityPick(one, { subjectCode: "", curriculumId: "", levelId: "" }, true),
    ).toEqual({
      subjectCode: "physics",
      curriculumId: "cur-brit",
      levelId: "g12",
    });
  });

  it("matches capabilities for the cascade pick", () => {
    const matches = capabilitiesMatchingPick(approvedCapabilitiesForService(caps, "svc"), {
      subjectCode: "math",
      curriculumId: "cur-eg",
      levelId: "g10",
    });
    expect(matches.map((row) => row.id)).toEqual(["1"]);
  });

  it("shows one duration chip after grade, none before (same duration across grades)", () => {
    const homeworkCaps = ["g7", "g8", "g9", "g10"].map((levelId, index) =>
      cap({
        id: `hw-${levelId}`,
        subjectCode: "homework",
        subjectNameEn: "Homework support",
        subjectNameAr: "مساعدة واجبات",
        curriculumId: "cur-us",
        curriculumCode: "american",
        curriculumNameEn: "American (Diploma)",
        curriculumNameAr: "أمريكي",
        levelId,
        levelCode: levelId,
        levelNameEn: levelId,
        levelNameAr: levelId,
        durationMin: 120,
        price: 150 + index * 10,
      }),
    );
    const approved = approvedCapabilitiesForService(homeworkCaps, "svc");
    const beforeGrade = durationOptionsFromCapabilityPick(
      approved,
      { subjectCode: "homework", curriculumId: "cur-us", levelId: "" },
      true,
    );
    expect(beforeGrade).toEqual([]);
    const afterGrade = durationOptionsFromCapabilityPick(
      approved,
      { subjectCode: "homework", curriculumId: "cur-us", levelId: "g8" },
      true,
    );
    expect(afterGrade).toHaveLength(1);
    expect(afterGrade[0]!.durationMin).toBe(120);
    expect(afterGrade[0]!.price).toBe(160);
  });

  it("soleOptionValue returns empty when ambiguous", () => {
    expect(soleOptionValue([{ value: "a", label: "A" }, { value: "b", label: "B" }])).toBe("");
    expect(soleOptionValue([{ value: "a", label: "A" }])).toBe("a");
  });

  it("represents na curriculum the same in fromCapability and coerce (single quran lesson)", () => {
    const quran = cap({
      id: "quran-60",
      subjectCode: "quran",
      subjectNameEn: "Quran",
      subjectNameAr: "قرآن",
      curriculumId: "cur-na",
      curriculumCode: TEACHING_CURRICULUM_NA_CODE,
      curriculumNameEn: "N/A",
      curriculumNameAr: "—",
      levelId: "lvl-a",
      levelCode: "beginner",
      levelNameEn: "Beginner",
      levelNameAr: "مبتدئ",
      durationMin: 60,
    });
    const fromCap = capabilityPickFromCapability(quran);
    expect(fromCap).toEqual({
      subjectCode: "quran",
      curriculumId: "",
      levelId: "lvl-a",
    });
    const coerced = coerceCapabilityPick([quran], fromCap, false);
    expect(coerced).toEqual(fromCap);
    const matches = capabilitiesMatchingPick([quran], coerced);
    expect(matches).toEqual([quran]);
  });
});