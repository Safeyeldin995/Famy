import { describe, expect, it } from "vitest";
import {
  pickDefaultCapabilityForEducation,
  shouldPersistBookingEducation,
} from "../bookingEducationAutofill";
import type { TeachingCapabilityOption } from "../teachingCapabilities";

const cap = (overrides: Partial<TeachingCapabilityOption>): TeachingCapabilityOption => ({
  id: "cap-1",
  providerId: "prov-1",
  serviceId: "svc-1",
  curriculumId: "cur-1",
  levelId: "lvl-10",
  subjectCode: "math",
  subjectNameEn: "Mathematics",
  subjectNameAr: "الرياضيات",
  curriculumCode: "eg_national_ar",
  curriculumNameEn: "Egyptian",
  curriculumNameAr: "مصري",
  levelCode: "g10",
  levelNameEn: "Grade 10",
  levelNameAr: "الصف العاشر",
  durationMin: 120,
  price: 400,
  status: "approved",
  maxSessionDurationMin: 180,
  ...overrides,
});

describe("booking education autofill", () => {
  it("prefers a capability that matches the saved curriculum and level", () => {
    const capabilities = [
      cap({ id: "other", curriculumId: "cur-2", levelId: "lvl-9" }),
      cap({ id: "match", curriculumId: "cur-1", levelId: "lvl-10" }),
    ];
    expect(
      pickDefaultCapabilityForEducation(capabilities, "svc-1", "cur-1", "lvl-10")?.id,
    ).toBe("match");
  });

  it("does not persist booking edits unless save-for-next-time is checked", () => {
    expect(
      shouldPersistBookingEducation({
        saveForNextTime: false,
        draft: { educationCurriculumId: "cur-1", educationLevelId: "lvl-10" },
        saved: { educationCurriculumId: null, educationLevelId: null },
      }),
    ).toBe(false);
    expect(
      shouldPersistBookingEducation({
        saveForNextTime: true,
        draft: { educationCurriculumId: "cur-1", educationLevelId: "lvl-10" },
        saved: { educationCurriculumId: null, educationLevelId: null },
      }),
    ).toBe(true);
    expect(
      shouldPersistBookingEducation({
        saveForNextTime: true,
        draft: { educationCurriculumId: "cur-1", educationLevelId: "lvl-10" },
        saved: { educationCurriculumId: "cur-1", educationLevelId: "lvl-10" },
      }),
    ).toBe(false);
  });
});
