/** Preserves rebook-restored tutoring until the customer changes service or recipient. */
export type RebookTutoringSeed = {
  serviceId: string;
  forWhom: string;
};

export function rebookTutoringSeedMatches(
  seed: RebookTutoringSeed | null,
  serviceId: string | null | undefined,
  forWhom: string,
): boolean {
  if (!seed || !serviceId) return false;
  return seed.serviceId === serviceId && seed.forWhom === forWhom;
}

export type RebookSupervisionSeed = {
  serviceId: string;
};

export function rebookSupervisionSeedMatches(
  seed: RebookSupervisionSeed | null,
  serviceId: string | null | undefined,
): boolean {
  if (!seed || !serviceId) return false;
  return seed.serviceId === serviceId;
}
