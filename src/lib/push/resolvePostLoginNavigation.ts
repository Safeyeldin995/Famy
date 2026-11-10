import {
  mapNotificationDeepLink,
  type NativeDeepLinkTarget,
  type PushWorkspace,
} from "./mapNotificationDeepLink";

export type PostLoginHref =
  | string
  | { pathname: NativeDeepLinkTarget["pathname"]; params: Record<string, string> };

/** After sign-in: open a stashed push destination, otherwise the default landing route. */
export function resolvePostLoginNavigation(
  pendingDeepLink: string | null | undefined,
  workspace: PushWorkspace,
  defaultPath: string,
): PostLoginHref {
  if (!pendingDeepLink) return defaultPath;
  const target = mapNotificationDeepLink(pendingDeepLink, workspace);
  if ("params" in target && target.params) {
    return { pathname: target.pathname, params: target.params };
  }
  return target.pathname;
}
