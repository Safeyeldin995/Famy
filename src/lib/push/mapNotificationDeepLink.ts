export type PushWorkspace = "customer" | "provider";

export type NativeDeepLinkTarget =
  | { pathname: "/home" }
  | { pathname: "/dashboard" }
  | { pathname: "/bookings" }
  | { pathname: "/messages" }
  | { pathname: "/notifications" }
  | { pathname: "/pro-notifications" }
  | { pathname: "/pro-messages" }
  | { pathname: "/jobs" }
  | { pathname: "/earnings" }
  | { pathname: "/pro-onboarding" }
  | { pathname: "/pro-profile" }
  | { pathname: "/pro-request-service" }
  | { pathname: "/login" }
  | { pathname: "/booking/[id]"; params: { id: string } }
  | { pathname: "/pro-booking/[id]"; params: { id: string } }
  | { pathname: "/chat/[id]"; params: { id: string } }
  | { pathname: "/pro-chat/[id]"; params: { id: string } }
  | { pathname: "/provider/[id]"; params: { id: string } };

export function workspaceHome(workspace: PushWorkspace): NativeDeepLinkTarget {
  return workspace === "provider" ? { pathname: "/dashboard" } : { pathname: "/home" };
}

/** Maps Famy web notification deep links to Expo Router targets for the signed-in workspace. */
export function mapNotificationDeepLink(
  deepLink: string | null | undefined,
  workspace: PushWorkspace,
): NativeDeepLinkTarget {
  const home = workspaceHome(workspace);
  if (!deepLink || deepLink === "/") return home;

  const withoutHash = deepLink.split("#")[0] ?? "/";
  const path = withoutHash.split("?")[0]?.replace(/\/+$/, "") || "/";

  const customerBooking = path.match(/^\/booking\/([^/]+)$/);
  if (customerBooking) {
    return workspace === "customer"
      ? { pathname: "/booking/[id]", params: { id: customerBooking[1]! } }
      : home;
  }

  const providerBooking = path.match(/^\/pro\/booking\/([^/]+)$/);
  if (providerBooking) {
    return workspace === "provider"
      ? { pathname: "/pro-booking/[id]", params: { id: providerBooking[1]! } }
      : home;
  }

  const thread = path.match(/^\/messages\/([^/]+)$/);
  if (thread) {
    return workspace === "provider"
      ? { pathname: "/pro-chat/[id]", params: { id: thread[1]! } }
      : { pathname: "/chat/[id]", params: { id: thread[1]! } };
  }

  const providerProfile = path.match(/^\/provider\/([^/]+)$/);
  if (providerProfile && workspace === "customer") {
    return { pathname: "/provider/[id]", params: { id: providerProfile[1]! } };
  }

  if (path === "/notifications") {
    return workspace === "provider" ? { pathname: "/pro-notifications" } : { pathname: "/notifications" };
  }
  if (path === "/bookings" && workspace === "customer") return { pathname: "/bookings" };
  if (path === "/messages" && workspace === "customer") return { pathname: "/messages" };
  if (path === "/messages" && workspace === "provider") return { pathname: "/pro-messages" };
  if (path === "/home" && workspace === "customer") return { pathname: "/home" };
  if (path === "/pro/bookings" && workspace === "provider") return { pathname: "/jobs" };
  if (path === "/pro" && workspace === "provider") return { pathname: "/dashboard" };
  if (path === "/pro/earnings" && workspace === "provider") return { pathname: "/earnings" };
  if (path === "/pro/onboarding" && workspace === "provider") return { pathname: "/pro-onboarding" };
  if (path === "/pro/profile" && workspace === "provider") return { pathname: "/pro-profile" };
  if (path === "/pro/request-service" && workspace === "provider") return { pathname: "/pro-request-service" };

  return home;
}
