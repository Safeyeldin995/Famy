import { ONLINE_WEB_ROUTE_IDS } from "./onlineWebSurface";

/**
 * Where a notification opens on the website. Notifications are written with app
 * deep links; the /online surface keeps online links and sends the rest to the
 * matching site page (booking pages redirect online bookings back to /online).
 */
export function onlineWebNotificationHref(deepLink: string | null | undefined): string | null {
  if (!deepLink) return null;
  const path = deepLink.split("#")[0] ?? "";
  if (!path.startsWith("/")) return null;
  if (path.startsWith("//") || path.includes("\\")) return null;
  // «أبنائي» (grade «صح؟» and «بلغني» alerts) lives under /online on the website.
  // «تقدم {name}» (lesson report alerts to a linked parent) opens /online/students/<id>.
  if (
    path === "/account/students" ||
    path.startsWith("/account/students?") ||
    path.startsWith("/account/students/")
  ) {
    return ONLINE_WEB_ROUTE_IDS.students + path.slice("/account/students".length);
  }
  return path;
}
