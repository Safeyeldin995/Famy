import { describe, expect, it } from "vitest";
import {
  providerMatchesStudentEducation,
  sortProvidersForStudentEducation,
  tutoringMatchBadgeLabel,
} from "../tutoringProviderMatch";
import type { TeachingCapabilityOption } from "../teachingCapabilities";

const capability = (providerId: string): TeachingCapabilityOption => ({
  id: `cap-${providerId}`,
  providerId,
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
});

describe("tutoring provider match", () => {
  it("sorts matching providers ahead without hiding anyone", () => {
    const providers = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const capabilities = [capability("b")];
    const sorted = sortProvidersForStudentEducation(providers, capabilities, {
      serviceId: "svc-1",
      curriculumId: "cur-1",
      levelId: "lvl-10",
    });
    expect(sorted.map((row) => row.id)).toEqual(["b", "a", "c"]);
  });

  it("builds the student badge label", () => {
    expect(
      tutoringMatchBadgeLabel("Layla", (key, options) =>
        key === "studentEducation.matchBadge" ? `Good fit for ${options?.name}` : key,
      ),
    ).toBe("Good fit for Layla");
    expect(providerMatchesStudentEducation("b", [capability("b")], {
      serviceId: "svc-1",
      curriculumId: "cur-1",
      levelId: "lvl-10",
    })).toBe(true);
  });
});
