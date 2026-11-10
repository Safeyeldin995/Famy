import { mapNotificationDeepLink, type PushWorkspace } from "@shared/push/mapNotificationDeepLink";
import type { Workspace } from "./session";
import { navigatePushTarget } from "./pushNavigation";

function pushWorkspace(workspace: Workspace): PushWorkspace {
  return workspace === "provider" ? "provider" : "customer";
}

export function openNotificationDeepLink(
  deepLink: string | null | undefined,
  workspace: Workspace,
): void {
  navigatePushTarget(mapNotificationDeepLink(deepLink, pushWorkspace(workspace)));
}
