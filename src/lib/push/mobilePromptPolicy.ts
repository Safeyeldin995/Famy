export type MobilePushWorkspace = "customer" | "provider";

export type MobileOsPermission = "granted" | "denied" | "undetermined";

/** Provider: explain + request on first app open while permission is undetermined. */
export function shouldShowMobileLaunchPushModal(
  workspace: MobilePushWorkspace,
  permission: MobileOsPermission,
  promptSeen: boolean,
): boolean {
  if (permission !== "undetermined") return false;
  if (promptSeen) return false;
  if (workspace === "customer") return false;
  return true;
}

/** Customer: only after first booking (or settings), never on cold launch. */
export function shouldShowMobileCustomerExplanationPushModal(
  permission: MobileOsPermission,
  promptSeen: boolean,
): boolean {
  if (permission !== "undetermined") return false;
  if (promptSeen) return false;
  return true;
}