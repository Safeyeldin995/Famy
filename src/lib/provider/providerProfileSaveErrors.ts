export function providerProfileSaveErrorKey(message: string | undefined): string {
  if (
    message?.includes("Verified identity data cannot be changed without review.") ||
    message?.includes("Verified identity data cannot be changed without review")
  ) {
    return "pro.profile.verifiedIdentityLocked";
  }
  return "pro.profile.saveFailed";
}
