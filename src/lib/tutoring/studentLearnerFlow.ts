/**
 * Student learning profile, booking flow (issue #536, PR 2).
 *
 * Shared by the website (/online) and the mobile app. The flow has no filter UI:
 *   1. «الحجز لمين؟» picks the learner (the account owner or one of their children);
 *   2. a missing education system or grade is filled in two steps (system, then grade);
 *   3. the parent picks the subject (Quran and music also pick a level);
 *   4. only tutors who teach that subject for that learner's system and grade are shown.
 *
 * Pure helpers only: no React, no Supabase, no storage.
 */
import { tutoringServiceKind, type TutoringServiceKind } from "./tutoringProviderMatch";

export const MYSELF_LEARNER_ID = "myself";

export type LearnerSource = {
  id: string;
  full_name: string | null;
  education_curriculum_id?: string | null;
  education_level_id?: string | null;
};

export type LearnerOption = {
  /** "myself" or a family member id (the same value the booking `forWhom` uses). */
  id: string;
  kind: "self" | "child";
  firstName: string | null;
  curriculumId: string | null;
  levelId: string | null;
};

function firstName(fullName: string | null | undefined): string | null {
  const trimmed = fullName?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

/** «أنا» first, then each active child in the order they were added. */
export function buildLearnerOptions(input: {
  selfFullName: string | null | undefined;
  selfProfile:
    | { education_curriculum_id?: string | null; education_level_id?: string | null }
    | null
    | undefined;
  children: LearnerSource[];
}): LearnerOption[] {
  return [
    {
      id: MYSELF_LEARNER_ID,
      kind: "self",
      firstName: firstName(input.selfFullName),
      curriculumId: input.selfProfile?.education_curriculum_id ?? null,
      levelId: input.selfProfile?.education_level_id ?? null,
    },
    ...input.children.map((c) => ({
      id: c.id,
      kind: "child" as const,
      firstName: firstName(c.full_name),
      curriculumId: c.education_curriculum_id ?? null,
      levelId: c.education_level_id ?? null,
    })),
  ];
}

/** A student who signed up for themselves and has no children skips «الحجز لمين؟». */
export function shouldAskForWhom(options: LearnerOption[]): boolean {
  return options.some((o) => o.kind === "child");
}

/**
 * The learner to start with: the remembered choice when it still exists,
 * otherwise «أنا».
 */
export function initialLearnerId(
  options: LearnerOption[],
  remembered: string | null | undefined,
): string {
  if (remembered && options.some((o) => o.id === remembered)) return remembered;
  return MYSELF_LEARNER_ID;
}

export function findLearner(
  options: LearnerOption[],
  id: string | null | undefined,
): LearnerOption | null {
  return options.find((o) => o.id === id) ?? null;
}

/** School and homework services need the learner's system and grade; Quran and music do not. */
export function serviceNeedsSchoolProfile(serviceSlug: string | null | undefined): boolean {
  return tutoringServiceKind(serviceSlug) !== "skill";
}

export function learnerNeedsProfile(
  learner: Pick<LearnerOption, "curriculumId" | "levelId"> | null,
  serviceSlug: string | null | undefined,
): boolean {
  if (!serviceNeedsSchoolProfile(serviceSlug)) return false;
  return !learner?.curriculumId || !learner?.levelId;
}

/** The learner id as the booking family member id (null for «أنا»). */
export function learnerFamilyMemberId(learnerId: string | null | undefined): string | null {
  return !learnerId || learnerId === MYSELF_LEARNER_ID ? null : learnerId;
}

export type SubjectRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  sort_order?: number;
};
export type SubjectServiceRow = { subject_id: string; service_id: string };

/** Subjects offered for a service, in catalog order. */
export function subjectsForService(
  subjects: SubjectRow[],
  subjectServices: SubjectServiceRow[],
  serviceId: string | null | undefined,
): SubjectRow[] {
  if (!serviceId) return [];
  const ids = new Set(
    subjectServices.filter((r) => r.service_id === serviceId).map((r) => r.subject_id),
  );
  return subjects
    .filter((s) => ids.has(s.id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code));
}

export const SKILL_LEVEL_CODES = [
  "skill_beginner",
  "skill_intermediate",
  "skill_advanced",
] as const;

export type LevelRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  sort_order?: number;
};

export function skillLevels(levels: LevelRow[]): LevelRow[] {
  return levels
    .filter((l) => (SKILL_LEVEL_CODES as readonly string[]).includes(l.code))
    .sort(
      (a, b) =>
        SKILL_LEVEL_CODES.indexOf(a.code as never) - SKILL_LEVEL_CODES.indexOf(b.code as never),
    );
}

/** Grades offered for school systems: KG then grade 1 to 12. */
export function schoolGrades(levels: LevelRow[]): LevelRow[] {
  const order = (code: string) =>
    code === "kg" ? 0 : Number(/^g(\d{1,2})$/.exec(code)?.[1] ?? 99);
  return levels
    .filter((l) => l.code === "kg" || /^g(\d{1,2})$/.test(l.code))
    .sort((a, b) => order(a.code) - order(b.code));
}

/** Systems a learner can pick (every active curriculum except the "no curriculum" entry for Quran/music). */
export function schoolSystems<T extends { code: string }>(curricula: T[]): T[] {
  return curricula.filter((c) => c.code !== "na");
}

export type MatchStep = "learner" | "profile" | "subject" | "results";

/** Which step the matching panel should show next. */
export function nextMatchStep(input: {
  learner: Pick<LearnerOption, "curriculumId" | "levelId"> | null;
  serviceSlug: string | null | undefined;
  subjectId: string | null;
  skillLevelId: string | null;
}): MatchStep {
  if (!input.learner) return "learner";
  if (learnerNeedsProfile(input.learner, input.serviceSlug)) return "profile";
  const kind: TutoringServiceKind = tutoringServiceKind(input.serviceSlug);
  if (kind === "homework") return "results";
  if (!input.subjectId) return "subject";
  if (kind === "skill" && !input.skillLevelId) return "subject";
  return "results";
}

/** Arguments for `match_tutors_for_student` (same rules as the SQL function). */
export function matchRpcArgs(input: {
  serviceId: string;
  serviceSlug: string | null | undefined;
  subjectId: string | null;
  skillLevelId: string | null;
  learner: Pick<LearnerOption, "curriculumId" | "levelId"> | null;
  serviceMode: "online" | "in_person";
  addressId?: string | null;
}): {
  p_service_id: string;
  p_subject_id: string | null;
  p_curriculum_id: string | null;
  p_level_id: string | null;
  p_service_mode: "online" | "in_person";
  p_address_id: string | null;
} {
  const kind = tutoringServiceKind(input.serviceSlug);
  const base = {
    p_service_id: input.serviceId,
    p_service_mode: input.serviceMode,
    p_address_id: input.addressId ?? null,
  };
  if (kind === "skill") {
    return {
      ...base,
      p_subject_id: input.subjectId,
      p_curriculum_id: null,
      p_level_id: input.skillLevelId,
    };
  }
  if (kind === "homework") {
    return {
      ...base,
      p_subject_id: null,
      p_curriculum_id: input.learner?.curriculumId ?? null,
      p_level_id: input.learner?.levelId ?? null,
    };
  }
  return {
    ...base,
    p_subject_id: input.subjectId,
    p_curriculum_id: input.learner?.curriculumId ?? null,
    p_level_id: input.learner?.levelId ?? null,
  };
}

/** Parts of the empty-state sentence «مفيش مدرس متاح لـ {subject} {grade} {system} دلوقتي». */
export function noMatchDescription(parts: {
  subject: string | null;
  grade: string | null;
  system: string | null;
}): string {
  return [parts.subject, parts.grade, parts.system].filter((p) => p && p.trim()).join(" ");
}

/** Search params for the booking page when a tutor is picked from the matched list. */
export function requestSearchFromMatch(input: { learnerId: string; capabilityId: string | null }): {
  learner?: string;
  cap?: string;
} {
  const out: { learner?: string; cap?: string } = {};
  if (input.learnerId && input.learnerId !== MYSELF_LEARNER_ID) out.learner = input.learnerId;
  if (input.capabilityId) out.cap = input.capabilityId;
  return out;
}

/** Guest picks kept in the browser until sign-up, then saved to the learner's own profile. */
export type PendingGuestProfile = { curriculumId: string; levelId: string };

export function parsePendingGuestProfile(
  raw: string | null | undefined,
): PendingGuestProfile | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingGuestProfile>;
    if (
      typeof v.curriculumId === "string" &&
      v.curriculumId &&
      typeof v.levelId === "string" &&
      v.levelId
    ) {
      return { curriculumId: v.curriculumId, levelId: v.levelId };
    }
  } catch {
    /* ignore malformed storage */
  }
  return null;
}

/** Save the guest picks only when the signed-in learner has no system or grade yet. */
export function shouldApplyPendingGuestProfile(
  pending: PendingGuestProfile | null,
  selfProfile:
    | { education_curriculum_id?: string | null; education_level_id?: string | null }
    | null
    | undefined,
): boolean {
  if (!pending) return false;
  return !selfProfile?.education_curriculum_id || !selfProfile?.education_level_id;
}

/**
 * Tutor banner: an approved tutoring service with no approved subject / system / grade
 * means students can't find the tutor.
 */
export function tutorMissingTeachingData(input: {
  approvedTutoringServiceIds: string[];
  approvedCapabilityServiceIds: string[];
}): boolean {
  if (!input.approvedTutoringServiceIds.length) return false;
  const covered = new Set(input.approvedCapabilityServiceIds);
  return input.approvedTutoringServiceIds.some((id) => !covered.has(id));
}

type MatchCapability = {
  providerId: string;
  serviceId: string;
  status: string;
  subjectCode: string;
  curriculumId: string;
  levelId: string;
};

/**
 * Client-side mirror of `match_tutors_for_student` for lists that already hold the
 * approved capabilities (the app's category screens). A null criterion is a wildcard,
 * matching the SQL function; the capability must be approved and for the same service.
 */
export function filterProvidersByMatch<T extends { id: string }>(
  providers: T[],
  capabilities: MatchCapability[],
  criteria: {
    serviceId: string;
    subjectCode: string | null;
    curriculumId: string | null;
    levelId: string | null;
  },
): T[] {
  const ok = new Set(
    capabilities
      .filter(
        (c) =>
          c.status === "approved" &&
          c.serviceId === criteria.serviceId &&
          (!criteria.subjectCode || c.subjectCode === criteria.subjectCode) &&
          (!criteria.curriculumId || c.curriculumId === criteria.curriculumId) &&
          (!criteria.levelId || c.levelId === criteria.levelId),
      )
      .map((c) => c.providerId),
  );
  return providers.filter((p) => ok.has(p.id));
}

/** The matched capability for one provider (the cheapest, as the SQL function orders it). */
export function matchedCapabilityFor<
  C extends MatchCapability & { id: string; price: number; durationMin: number },
>(
  providerId: string,
  capabilities: C[],
  criteria: {
    serviceId: string;
    subjectCode: string | null;
    curriculumId: string | null;
    levelId: string | null;
  },
): C | null {
  const rows = capabilities.filter(
    (c) =>
      c.providerId === providerId &&
      c.status === "approved" &&
      c.serviceId === criteria.serviceId &&
      (!criteria.subjectCode || c.subjectCode === criteria.subjectCode) &&
      (!criteria.curriculumId || c.curriculumId === criteria.curriculumId) &&
      (!criteria.levelId || c.levelId === criteria.levelId),
  );
  rows.sort((a, b) => a.price - b.price || a.durationMin - b.durationMin);
  return rows[0] ?? null;
}
