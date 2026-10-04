export function shouldClearStaleEducationLevel(args: {
  educationLevelId: string;
  filteredLevelIds: string[];
  taxonomyLoaded: boolean;
}): boolean {
  if (!args.educationLevelId) return false;
  if (!args.taxonomyLoaded) return false;
  return !args.filteredLevelIds.includes(args.educationLevelId);
}
