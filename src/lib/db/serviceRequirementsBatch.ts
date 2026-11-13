/** Requirements for provider apply checklist — empty selection needs no fetch. */
export function requirementsBatchQueryKey(serviceIds: string[]): string {
  return [...serviceIds].sort().join(",");
}

export async function fetchRequirementsForServiceIds<T>(
  serviceIds: string[],
  load: (ids: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (serviceIds.length === 0) return [];
  return load(serviceIds);
}
