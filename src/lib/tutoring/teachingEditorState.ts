export function teachingMissingChoice(subject: string, curriculum: string, levels: readonly string[], priceValid: boolean) {
  if (!subject) return "subject";
  if (!curriculum) return "curriculum";
  if (!levels.length) return "level";
  if (!priceValid) return "price";
  return null;
}

export function taxonomyState(query: { isLoading?: boolean; isError?: boolean }, count: number) {
  if (query.isError) return "error";
  if (query.isLoading) return "loading";
  return count ? "ready" : "empty";
}
