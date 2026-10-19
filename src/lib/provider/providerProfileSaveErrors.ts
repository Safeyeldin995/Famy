export function providerProfileSaveErrorKey(message: string | undefined): string {
  if (
    message?.includes("Verified identity data cannot be changed without review.") ||
    message?.includes("Verified identity data cannot be changed without review")
  ) {
    return "pro.profile.verifiedIdentityLocked";
  }
  if (message?.includes("read-only while under review") || message?.includes("not editable in the current status")) return "providerProfileFix.reviewLocked";
  if (message?.includes("authorization required") || message?.includes("auth required") || message?.includes("JWT expired")) return "providerProfileFix.signIn";
  if (message?.includes("Provider profile not found")) return "providerProfileFix.notFound";
  if (message?.includes("years_experience")) return "providerProfileFix.invalidYears";
  if (message?.includes("max_children_per_booking")) return "providerProfileFix.invalidChildren";
  return "pro.profile.saveFailed";
}
