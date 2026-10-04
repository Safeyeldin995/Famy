export function canPersistSetupEducationProfile(query: {
  isSuccess: boolean;
  isError: boolean;
}): boolean {
  return query.isSuccess && !query.isError;
}
