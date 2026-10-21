import type { Workspace } from "./session";

export type NativeDeepLink =
  | { pathname: "/booking/[id]"; params: { id: string } }
  | { pathname: "/chat/[id]"; params: { id: string } }
  | { pathname: "/notifications" }
  | { pathname: "/bookings" }
  | { pathname: "/messages" }
  | { pathname: "/pro-messages" }
  | { pathname: "/pro-booking/[id]"; params: { id: string } }
  | { pathname: "/pro-chat/[id]"; params: { id: string } }
  | { pathname: "/pro-notifications" }
  | { pathname: "/dashboard" }
  | { pathname: "/jobs" }
  | { pathname: "/earnings" };

function notificationsFallback(workspace: Workspace): NativeDeepLink {
  return workspace === "provider" ? { pathname: "/pro-notifications" } : { pathname: "/notifications" };
}

/** Maps web notification deep links to Expo Router paths for the signed-in workspace. */
export function mapNotificationDeepLink(
  deepLink: string | null | undefined,
  workspace: Workspace,
): NativeDeepLink {
  const fallback = notificationsFallback(workspace);
  if (!deepLink || deepLink === "/") return fallback;

  const path = deepLink.split("?")[0]?.replace(/\/+$/, "") || "/";

  const booking = path.match(/^\/booking\/([^/]+)$/);
  if (booking && workspace === "customer") {
    return { pathname: "/booking/[id]", params: { id: booking[1]! } };
  }

  const proBooking = path.match(/^\/pro\/booking\/([^/]+)$/);
  if (proBooking && workspace === "provider") {
    return { pathname: "/pro-booking/[id]", params: { id: proBooking[1]! } };
  }

  const thread = path.match(/^\/messages\/([^/]+)$/);
  if (thread) {
    return workspace === "provider"
      ? { pathname: "/pro-chat/[id]", params: { id: thread[1]! } }
      : { pathname: "/chat/[id]", params: { id: thread[1]! } };
  }

  if (path === "/notifications") {
    return workspace === "provider" ? { pathname: "/pro-notifications" } : { pathname: "/notifications" };
  }

  if (path === "/bookings" && workspace === "customer") return { pathname: "/bookings" };
  if (path === "/messages" && workspace === "customer") return { pathname: "/messages" };

  if (path === "/messages" && workspace === "provider") return { pathname: "/pro-messages" };
  if (path === "/pro/bookings" && workspace === "provider") return { pathname: "/jobs" };
  if (path === "/pro" && workspace === "provider") return { pathname: "/dashboard" };
  if (path === "/pro/earnings" && workspace === "provider") return { pathname: "/earnings" };

  return fallback;
}
