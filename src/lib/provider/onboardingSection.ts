const SECTIONS = ["personal", "services", "experience", "coverage", "references", "review"] as const;
export type OnboardingTarget = typeof SECTIONS[number];
/** Deep links used by the temporary post-submit checklist. */
export function onboardingSection(search: Record<string, unknown>): { section?: OnboardingTarget } {
  return typeof search.section === "string" && SECTIONS.includes(search.section as OnboardingTarget)
    ? { section: search.section as OnboardingTarget } : {};
}

export function onboardingInitialStep(section: unknown): number {
  return Math.max(0, SECTIONS.indexOf(section as OnboardingTarget));
}
