import type { TeachingCapabilityOption } from "@/lib/tutoring/teachingCapabilities";

export type TutoringMatchContext = {
  serviceId: string | null | undefined;
  curriculumId: string | null;
  levelId: string | null;
  /** Optional: when set, the tutor must also teach this subject. */
  subjectCode?: string | null;
  studentFirstName: string | null;
};

type MatchCriteria = Pick<TutoringMatchContext, "serviceId" | "curriculumId" | "levelId" | "subjectCode">;

/** True when the student's system and grade are both known, so matching can be strict. */
export function hasStudentEducation(ctx: Pick<TutoringMatchContext, "curriculumId" | "levelId">): boolean {
  return Boolean(ctx.curriculumId && ctx.levelId);
}

export function providerMatchesStudentEducation(
  providerId: string,
  capabilities: TeachingCapabilityOption[],
  ctx: MatchCriteria,
): boolean {
  if (!hasStudentEducation(ctx)) return false;
  return capabilities.some(
    (cap) =>
      cap.providerId === providerId &&
      cap.status === "approved" &&
      (!ctx.serviceId || cap.serviceId === ctx.serviceId) &&
      cap.curriculumId === ctx.curriculumId &&
      cap.levelId === ctx.levelId &&
      (!ctx.subjectCode || cap.subjectCode === ctx.subjectCode),
  );
}

/**
 * Strict matching (PO decision, issue #536): once the student's system and grade are known,
 * only tutors with an approved capability for that exact system + grade (+ subject when chosen)
 * are shown. Without a complete profile the list is returned unchanged.
 */
export function filterProvidersForStudentEducation<T extends { id: string }>(
  providers: T[],
  capabilities: TeachingCapabilityOption[],
  ctx: MatchCriteria,
): T[] {
  if (!hasStudentEducation(ctx)) return providers;
  return providers.filter((provider) =>
    providerMatchesStudentEducation(provider.id, capabilities, ctx),
  );
}

export type TutoringServiceKind = "school" | "homework" | "skill";

/** Quran and music use a skill level, homework follow-up covers every subject, the rest is school tutoring. */
export function tutoringServiceKind(serviceSlug: string | null | undefined): TutoringServiceKind {
  if (serviceSlug === "quran-lessons" || serviceSlug === "music-lessons") return "skill";
  if (serviceSlug === "homework-support") return "homework";
  return "school";
}

/**
 * Arguments for `match_tutors_for_student` per service kind:
 * - school: subject + the child's system + grade;
 * - homework: the child's system + grade, any subject;
 * - skill (Quran / music): subject + the chosen skill level, no curriculum.
 */
export function studentMatchCriteria(input: {
  serviceSlug: string | null | undefined;
  subjectId: string | null;
  curriculumId: string | null;
  levelId: string | null;
  skillLevelId?: string | null;
}): { subjectId: string | null; curriculumId: string | null; levelId: string | null } {
  const kind = tutoringServiceKind(input.serviceSlug);
  if (kind === "skill") {
    return { subjectId: input.subjectId, curriculumId: null, levelId: input.skillLevelId ?? null };
  }
  if (kind === "homework") {
    return { subjectId: null, curriculumId: input.curriculumId, levelId: input.levelId };
  }
  return { subjectId: input.subjectId, curriculumId: input.curriculumId, levelId: input.levelId };
}

export function tutoringMatchBadgeLabel(
  studentFirstName: string | null,
  t: (key: string, options?: Record<string, string>) => string,
): string | undefined {
  if (!studentFirstName) return undefined;
  return t("studentEducation.matchBadge", { name: studentFirstName });
}
