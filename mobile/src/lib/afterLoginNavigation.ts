import { router } from "expo-router";
import { resolvePostLoginNavigation } from "@shared/push/resolvePostLoginNavigation";
import type { PushWorkspace } from "@shared/push/mapNotificationDeepLink";
import { consumePendingPushDeepLink } from "./pendingPushDeepLink";
import type { Workspace } from "./session";

function toPushWorkspace(workspace: Workspace): PushWorkspace {
  return workspace === "provider" ? "provider" : "customer";
}

/** Single post-login navigation entry: consumes at most one pending push deep link. */
export async function replaceAfterLoginNavigation(
  workspace: Workspace,
  defaultPath: string,
): Promise<void> {
  const pending = await consumePendingPushDeepLink();
  const target = resolvePostLoginNavigation(pending, toPushWorkspace(workspace), defaultPath);
  if (typeof target === "string") {
    router.replace(target as never);
    return;
  }
  router.replace({
    pathname: target.pathname,
    params: target.params,
  } as never);
}
