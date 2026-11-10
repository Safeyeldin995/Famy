import { router } from "expo-router";
import type { NativeDeepLinkTarget } from "@shared/push/mapNotificationDeepLink";

export function navigatePushTarget(target: NativeDeepLinkTarget): void {
  if ("params" in target && target.params) {
    router.push({ pathname: target.pathname, params: target.params });
    return;
  }
  router.push(target.pathname);
}
