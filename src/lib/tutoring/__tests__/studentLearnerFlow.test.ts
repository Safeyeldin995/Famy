import { describe, expect, it } from "vitest";
import {
  MYSELF_LEARNER_ID,
  buildLearnerOptions,
  initialLearnerId,
  learnerFamilyMemberId,
  learnerNeedsProfile,
  matchRpcArgs,
  nextMatchStep,
  noMatchDescription,
  parsePendingGuestProfile,
  requestSearchFromMatch,
  schoolGrades,
  schoolSystems,
  shouldApplyPendingGuestProfile,
  shouldAskForWhom,
  skillLevels,
  subjectsForService,
  tutorMissingTeachingData,
} from "../studentLearnerFlow";

const options = buildLearnerOptions({
  selfFullName: "منى أحمد",
  selfProfile: null,
  children: [
    {
      id: "kid-1",
      full_name: "سليم أحمد",
      education_curriculum_id: "british",
      education_level_id: "g3",
    },
    { id: "kid-2", full_name: "ليلى", education_curriculum_id: null, education_level_id: null },
  ],
});

describe("learner options", () => {
  it("puts «أنا» first, then each child with the first name only", () => {
    expect(options.map((o) => [o.id, o.kind, o.firstName])).toEqual([
      [MYSELF_LEARNER_ID, "self", "منى"],
      ["kid-1", "child", "سليم"],
      ["kid-2", "child", "ليلى"],
    ]);
  });

  it("skips «الحجز لمين؟» for a student with no children", () => {
    const solo = buildLearnerOptions({ selfFullName: "Omar", selfProfile: null, children: [] });
    expect(shouldAskForWhom(solo)).toBe(false);
    expect(shouldAskForWhom(options)).toBe(true);
  });

  it("remembers the last learner only while it still exists", () => {
    expect(initialLearnerId(options, "kid-1")).toBe("kid-1");
    expect(initialLearnerId(options, "removed-kid")).toBe(MYSELF_LEARNER_ID);
    expect(initialLearnerId(options, null)).toBe(MYSELF_LEARNER_ID);
  });

  it("maps «أنا» to no family member and a child to its id", () => {
    expect(learnerFamilyMemberId(MYSELF_LEARNER_ID)).toBeNull();
    expect(learnerFamilyMemberId("kid-1")).toBe("kid-1");
  });
});

describe("profile and steps", () => {
  it("asks for system and grade for school and homework services, never for Quran or music", () => {
    const kid2 = options[2]!;
    expect(learnerNeedsProfile(kid2, "school-subject-tutoring")).toBe(true);
    expect(learnerNeedsProfile(kid2, "homework-support")).toBe(true);
    expect(learnerNeedsProfile(kid2, "quran-lessons")).toBe(false);
    expect(learnerNeedsProfile(options[1]!, "school-subject-tutoring")).toBe(false);
  });

  it("walks learner → profile → subject → results", () => {
    const kid1 = options[1]!;
    expect(
      nextMatchStep({ learner: null, serviceSlug: "x", subjectId: null, skillLevelId: null }),
    ).toBe("learner");
    expect(
      nextMatchStep({
        learner: options[2]!,
        serviceSlug: "school-subject-tutoring",
        subjectId: null,
        skillLevelId: null,
      }),
    ).toBe("profile");
    expect(
      nextMatchStep({
        learner: kid1,
        serviceSlug: "school-subject-tutoring",
        subjectId: null,
        skillLevelId: null,
      }),
    ).toBe("subject");
    expect(
      nextMatchStep({
        learner: kid1,
        serviceSlug: "school-subject-tutoring",
        subjectId: "math",
        skillLevelId: null,
      }),
    ).toBe("results");
    expect(
      nextMatchStep({
        learner: kid1,
        serviceSlug: "homework-support",
        subjectId: null,
        skillLevelId: null,
      }),
    ).toBe("results");
    expect(
      nextMatchStep({
        learner: options[2]!,
        serviceSlug: "quran-lessons",
        subjectId: "quran",
        skillLevelId: null,
      }),
    ).toBe("subject");
    expect(
      nextMatchStep({
        learner: options[2]!,
        serviceSlug: "quran-lessons",
        subjectId: "quran",
        skillLevelId: "beg",
      }),
    ).toBe("results");
  });
});

describe("match arguments (mirror match_tutors_for_student)", () => {
  const kid1 = options[1]!;
  it("school: subject + system + grade", () => {
    expect(
      matchRpcArgs({
        serviceId: "s",
        serviceSlug: "school-subject-tutoring",
        subjectId: "math",
        skillLevelId: null,
        learner: kid1,
        serviceMode: "online",
      }),
    ).toEqual({
      p_service_id: "s",
      p_subject_id: "math",
      p_curriculum_id: "british",
      p_level_id: "g3",
      p_service_mode: "online",
      p_address_id: null,
    });
  });
  it("homework: system + grade, any subject", () => {
    expect(
      matchRpcArgs({
        serviceId: "s",
        serviceSlug: "homework-support",
        subjectId: "math",
        skillLevelId: null,
        learner: kid1,
        serviceMode: "online",
      }),
    ).toMatchObject({ p_subject_id: null, p_curriculum_id: "british", p_level_id: "g3" });
  });
  it("Quran / music: subject + chosen level, no curriculum", () => {
    expect(
      matchRpcArgs({
        serviceId: "s",
        serviceSlug: "quran-lessons",
        subjectId: "q",
        skillLevelId: "beg",
        learner: kid1,
        serviceMode: "online",
      }),
    ).toMatchObject({ p_subject_id: "q", p_curriculum_id: null, p_level_id: "beg" });
  });
});

describe("catalog helpers", () => {
  it("lists the service's subjects in catalog order", () => {
    const subjects = [
      { id: "b", code: "b", name_ar: "ب", name_en: "B", sort_order: 2 },
      { id: "a", code: "a", name_ar: "أ", name_en: "A", sort_order: 1 },
      { id: "c", code: "c", name_ar: "ج", name_en: "C", sort_order: 3 },
    ];
    const links = [
      { subject_id: "b", service_id: "svc" },
      { subject_id: "a", service_id: "svc" },
      { subject_id: "c", service_id: "other" },
    ];
    expect(subjectsForService(subjects, links, "svc").map((s) => s.id)).toEqual(["a", "b"]);
    expect(subjectsForService(subjects, links, null)).toEqual([]);
  });

  it("orders grades KG, 1…12 and skill levels beginner → advanced", () => {
    const levels = [
      "g10",
      "skill_advanced",
      "g2",
      "kg",
      "skill_beginner",
      "g1",
      "skill_intermediate",
    ].map((code) => ({
      id: code,
      code,
      name_ar: code,
      name_en: code,
    }));
    expect(schoolGrades(levels).map((l) => l.code)).toEqual(["kg", "g1", "g2", "g10"]);
    expect(skillLevels(levels).map((l) => l.code)).toEqual([
      "skill_beginner",
      "skill_intermediate",
      "skill_advanced",
    ]);
  });

  it("hides the no-curriculum entry from the systems list", () => {
    expect(
      schoolSystems([{ code: "na" }, { code: "british" }, { code: "eg_azhar" }]).map((c) => c.code),
    ).toEqual(["british", "eg_azhar"]);
  });
});

describe("misc", () => {
  it("builds the empty-state description from the parts that exist", () => {
    expect(noMatchDescription({ subject: "رياضيات", grade: "3 ابتدائي", system: "أزهري" })).toBe(
      "رياضيات 3 ابتدائي أزهري",
    );
    expect(noMatchDescription({ subject: "قرآن", grade: null, system: "" })).toBe("قرآن");
  });

  it("passes the child and capability to the booking page", () => {
    expect(requestSearchFromMatch({ learnerId: "kid-1", capabilityId: "cap-9" })).toEqual({
      learner: "kid-1",
      cap: "cap-9",
    });
    expect(requestSearchFromMatch({ learnerId: MYSELF_LEARNER_ID, capabilityId: null })).toEqual(
      {},
    );
  });

  it("applies guest picks after sign-up only when the profile is still empty", () => {
    const pending = parsePendingGuestProfile('{"curriculumId":"british","levelId":"g3"}');
    expect(pending).toEqual({ curriculumId: "british", levelId: "g3" });
    expect(parsePendingGuestProfile("{bad")).toBeNull();
    expect(parsePendingGuestProfile('{"curriculumId":""}')).toBeNull();
    expect(shouldApplyPendingGuestProfile(pending, null)).toBe(true);
    expect(
      shouldApplyPendingGuestProfile(pending, {
        education_curriculum_id: "american",
        education_level_id: "g1",
      }),
    ).toBe(false);
  });

  it("flags tutors whose approved tutoring service has no approved teaching data", () => {
    expect(
      tutorMissingTeachingData({
        approvedTutoringServiceIds: [],
        approvedCapabilityServiceIds: [],
      }),
    ).toBe(false);
    expect(
      tutorMissingTeachingData({
        approvedTutoringServiceIds: ["a", "b"],
        approvedCapabilityServiceIds: ["a"],
      }),
    ).toBe(true);
    expect(
      tutorMissingTeachingData({
        approvedTutoringServiceIds: ["a"],
        approvedCapabilityServiceIds: ["a"],
      }),
    ).toBe(false);
  });
});

describe("client-side match mirror", () => {
  const caps = [
    {
      id: "c1",
      providerId: "p1",
      serviceId: "s",
      status: "approved",
      subjectCode: "math",
      curriculumId: "br",
      levelId: "g3",
      price: 200,
      durationMin: 60,
    },
    {
      id: "c2",
      providerId: "p1",
      serviceId: "s",
      status: "approved",
      subjectCode: "math",
      curriculumId: "br",
      levelId: "g3",
      price: 150,
      durationMin: 90,
    },
    {
      id: "c3",
      providerId: "p2",
      serviceId: "s",
      status: "approved",
      subjectCode: "math",
      curriculumId: "us",
      levelId: "g3",
      price: 100,
      durationMin: 60,
    },
    {
      id: "c4",
      providerId: "p3",
      serviceId: "s",
      status: "pending",
      subjectCode: "math",
      curriculumId: "br",
      levelId: "g3",
      price: 100,
      durationMin: 60,
    },
    {
      id: "c5",
      providerId: "p4",
      serviceId: "q",
      status: "approved",
      subjectCode: "quran",
      curriculumId: "na",
      levelId: "beg",
      price: 90,
      durationMin: 45,
    },
  ];
  const providers = [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }];
  it("keeps only approved tutors for the exact service, subject, system and grade", async () => {
    const { filterProvidersByMatch } = await import("../studentLearnerFlow");
    expect(
      filterProvidersByMatch(providers, caps, {
        serviceId: "s",
        subjectCode: "math",
        curriculumId: "br",
        levelId: "g3",
      }).map((p) => p.id),
    ).toEqual(["p1"]);
    expect(
      filterProvidersByMatch(providers, caps, {
        serviceId: "q",
        subjectCode: "quran",
        curriculumId: null,
        levelId: "beg",
      }).map((p) => p.id),
    ).toEqual(["p4"]);
  });
  it("picks the cheapest matching capability, like the SQL function", async () => {
    const { matchedCapabilityFor } = await import("../studentLearnerFlow");
    expect(
      matchedCapabilityFor("p1", caps, {
        serviceId: "s",
        subjectCode: "math",
        curriculumId: "br",
        levelId: "g3",
      })?.id,
    ).toBe("c2");
    expect(
      matchedCapabilityFor("p2", caps, {
        serviceId: "s",
        subjectCode: "math",
        curriculumId: "br",
        levelId: "g3",
      }),
    ).toBeNull();
  });
});
