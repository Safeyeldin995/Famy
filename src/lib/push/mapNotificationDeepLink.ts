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
  | { pathname: "/pro-online-lessons" }
  | { pathname: "/wallet" }
  | { pathname: "/pro-setup/[item]"; params: { item: string } }
  | { pathname: "/pro-documents" }
  | { pathname: "/login" }
  | { pathname: "/booking/[id]"; params: { id: string } }
  | { pathname: "/pro-booking/[id]"; params: { id: string } }
  | { pathname: "/chat/[id]"; params: { id: string } }
  | { pathname: "/pro-chat/[id]"; params: { id: string } }
  | { pathname: "/provider/[id]"; params: { id: string } }
  | { pathname: "/student-parent-link"; params?: { linkId?: string } };

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

  const parentLink = path.match(/^\/student-parent-link$/);
  if (parentLink && workspace === "customer") {
    const query = withoutHash.includes("?") ? withoutHash.split("?")[1] : "";
    const linkId = query
      ?.split("&")
      .map((part) => part.split("="))
      .find(([key]) => key === "linkId")?.[1];
    return linkId
      ? { pathname: "/student-parent-link", params: { linkId } }
      : { pathname: "/student-parent-link" };
  }

  if (path === "/notifications") {
    return workspace === "provider"
      ? { pathname: "/pro-notifications" }
      : { pathname: "/notifications" };
  }
  if (path === "/bookings" && workspace === "customer") return { pathname: "/bookings" };
  if (path === "/messages" && workspace === "customer") return { pathname: "/messages" };
  if (path === "/messages" && workspace === "provider") return { pathname: "/pro-messages" };
  if (path === "/home" && workspace === "customer") return { pathname: "/home" };
  if (path === "/pro/bookings" && workspace === "provider") return { pathname: "/jobs" };
  if (path === "/pro" && workspace === "provider") return { pathname: "/dashboard" };
  if (path === "/pro/earnings" && workspace === "provider") return { pathname: "/earnings" };
  if (path === "/pro/onboarding" && workspace === "provider")
    return { pathname: "/pro-onboarding" };
  if (path === "/pro/profile" && workspace === "provider") return { pathname: "/pro-profile" };
  if (path === "/pro/request-service" && workspace === "provider")
    return { pathname: "/pro-request-service" };
  if (path === "/pro/online-lessons" && workspace === "provider")
    return { pathname: "/pro-online-lessons" };
  if (path === "/wallet" && workspace === "customer") return { pathname: "/wallet" };

  if (path === "/pro/documents" && workspace === "provider") return { pathname: "/pro-documents" };

  const proSetup = path.match(/^\/pro\/setup\/([^/]+)$/);
  if (proSetup && workspace === "provider") {
    const raw = proSetup[1]!;
    const item = raw === "references" ? "reference" : raw;
    return { pathname: "/pro-setup/[item]", params: { item } };
  }

  return home;
}
