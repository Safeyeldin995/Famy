/** Only the documents/review deep link is supported; all other entries start normally. */
export function onboardingSection(search: Record<string, unknown>): { section?: "review" } {
  return search.section === "review" ? { section: "review" } : {};
}

export function onboardingInitialStep(section: unknown): number {
  return section === "review" ? 5 : 0;
}
