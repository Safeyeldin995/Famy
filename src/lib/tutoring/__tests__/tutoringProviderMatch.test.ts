import { describe, expect, it } from "vitest";
import {
  filterProvidersForStudentEducation,
  providerMatchesStudentEducation,
  studentMatchCriteria,
  tutoringMatchBadgeLabel,
  tutoringServiceKind,
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
  it("shows only matching tutors once the student's system and grade are known", () => {
    const providers = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const capabilities = [capability("b"), { ...capability("c"), levelId: "lvl-9" }];
    const filtered = filterProvidersForStudentEducation(providers, capabilities, {
      serviceId: "svc-1",
      curriculumId: "cur-1",
      levelId: "lvl-10",
    });
    expect(filtered.map((row) => row.id)).toEqual(["b"]);
  });

  it("keeps everyone when the student's profile is incomplete", () => {
    const providers = [{ id: "a" }, { id: "b" }];
    expect(
      filterProvidersForStudentEducation(providers, [capability("b")], {
        serviceId: "svc-1",
        curriculumId: "cur-1",
        levelId: null,
      }),
    ).toEqual(providers);
  });

  it("also requires the subject when one is chosen", () => {
    const caps = [capability("b")];
    const ctx = { serviceId: "svc-1", curriculumId: "cur-1", levelId: "lvl-10" };
    expect(providerMatchesStudentEducation("b", caps, { ...ctx, subjectCode: "math" })).toBe(true);
    expect(providerMatchesStudentEducation("b", caps, { ...ctx, subjectCode: "physics" })).toBe(false);
    // Pending capabilities never match.
    expect(providerMatchesStudentEducation("b", [{ ...capability("b"), status: "pending" }], ctx)).toBe(false);
  });

  it("builds match criteria per service kind", () => {
    expect(tutoringServiceKind("quran-lessons")).toBe("skill");
    expect(tutoringServiceKind("music-lessons")).toBe("skill");
    expect(tutoringServiceKind("homework-support")).toBe("homework");
    expect(tutoringServiceKind("school-subject-tutoring")).toBe("school");
    const base = { subjectId: "sub", curriculumId: "cur", levelId: "g4", skillLevelId: "beginner" };
    expect(studentMatchCriteria({ ...base, serviceSlug: "school-subject-tutoring" })).toEqual({
      subjectId: "sub",
      curriculumId: "cur",
      levelId: "g4",
    });
    expect(studentMatchCriteria({ ...base, serviceSlug: "homework-support" })).toEqual({
      subjectId: null,
      curriculumId: "cur",
      levelId: "g4",
    });
    expect(studentMatchCriteria({ ...base, serviceSlug: "quran-lessons" })).toEqual({
      subjectId: "sub",
      curriculumId: null,
      levelId: "beginner",
    });
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
