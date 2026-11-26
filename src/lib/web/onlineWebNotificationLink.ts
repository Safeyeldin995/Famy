/**
 * Where a notification opens on the website. Notifications are written with app
 * deep links; the /online surface keeps online links and sends the rest to the
 * matching site page (booking pages redirect online bookings back to /online).
 */
export function onlineWebNotificationHref(deepLink: string | null | undefined): string | null {
  if (!deepLink) return null;
  const path = deepLink.split("#")[0] ?? "";
  if (!path.startsWith("/")) return null;
  if (path.startsWith("//")) return null;
  return path;
}
