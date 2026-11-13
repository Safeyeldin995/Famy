/** Provider apply screen: block UI only until core onboarding queries succeed. */
export function providerApplyBootstrapLoading(
  queries: ReadonlyArray<{ isSuccess: boolean }>,
): boolean {
  return queries.some((q) => !q.isSuccess);
}
