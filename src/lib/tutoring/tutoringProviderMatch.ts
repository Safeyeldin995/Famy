import type { TeachingCapabilityOption } from "@/lib/tutoring/teachingCapabilities";

export type TutoringMatchContext = {
  serviceId: string | null | undefined;
  curriculumId: string | null;
  levelId: string | null;
  studentFirstName: string | null;
};

export function providerMatchesStudentEducation(
  providerId: string,
  capabilities: TeachingCapabilityOption[],
  ctx: Pick<TutoringMatchContext, "serviceId" | "curriculumId" | "levelId">,
): boolean {
  if (!ctx.curriculumId || !ctx.levelId) return false;
  return capabilities.some(
    (cap) =>
      cap.providerId === providerId &&
      cap.status === "approved" &&
      (!ctx.serviceId || cap.serviceId === ctx.serviceId) &&
      cap.curriculumId === ctx.curriculumId &&
      cap.levelId === ctx.levelId,
  );
}

export function sortProvidersForStudentEducation<T extends { id: string }>(
  providers: T[],
  capabilities: TeachingCapabilityOption[],
  ctx: Pick<TutoringMatchContext, "serviceId" | "curriculumId" | "levelId">,
): T[] {
  if (!ctx.curriculumId || !ctx.levelId) return providers;
  const matched: T[] = [];
  const rest: T[] = [];
  for (const provider of providers) {
    if (providerMatchesStudentEducation(provider.id, capabilities, ctx)) {
      matched.push(provider);
    } else {
      rest.push(provider);
    }
  }
  return [...matched, ...rest];
}

export function tutoringMatchBadgeLabel(
  studentFirstName: string | null,
  t: (key: string, options?: Record<string, string>) => string,
): string | undefined {
  if (!studentFirstName) return undefined;
  return t("studentEducation.matchBadge", { name: studentFirstName });
}
