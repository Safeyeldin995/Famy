import { isPreviewRoute } from "@/lib/preview/constants";

/** Customer-tab paths that should resolve to their Famy Pro equivalents. */
const PRO_ROUTE_ALIASES: Record<string, string> = {
  "/bookings": "/pro/bookings",
  "/notifications": "/pro/notifications",
  "/profile": "/pro/profile",
  "/notification-preferences": "/pro/notification-preferences",
};

/** Strips the /preview prefix from pro routes for active-tab matching. */
export function normalizeProPathname(pathname: string) {
  if (pathname.startsWith("/preview/pro")) {
    const stripped = pathname.slice("/preview".length);
    return stripped === "" ? "/pro" : stripped;
  }
  return pathname;
}

/** Rewrites pro paths (and customer aliases) for preview/pro browsing. */
export function proPath(path: string) {
  const resolved = PRO_ROUTE_ALIASES[path] ?? path;
  if (!isPreviewRoute()) return resolved;
  if (resolved === "/pro" || resolved.startsWith("/pro/")) {
    return `/preview${resolved}`;
  }
  return resolved;
}

/** Customer-app path — applies /preview/* rewrite when in design preview. */
export function customerPath(path: string) {
  if (!isPreviewRoute()) return path;
  return previewPath(path);
}

const PREVIEW_PATHS: Record<string, string> = {
  "/home": "/preview/home",
  "/search": "/preview/search",
  "/profile": "/preview/profile",
  "/messages": "/preview/messages",
  "/addresses": "/preview/addresses",
  "/addresses/new": "/preview/addresses/new",
  "/bookings": "/preview/bookings",
  "/notifications": "/preview/notifications",
  "/family-members": "/preview/family-members",
  "/notification-preferences": "/preview/notification-preferences",
  "/favorites": "/preview/favorites",
  "/promo-codes": "/preview/promo-codes",
  "/help": "/preview/help",
  "/login": "/preview/login",
  "/onboarding": "/preview/onboarding",
  "/setup": "/preview/setup",
  "/otp": "/preview/otp",
  "/auth/forgot": "/preview/forgot",
};

/** Rewrites in-app paths to their /preview/* equivalents when browsing the design preview. */
export function previewPath(path: string) {
  if (!isPreviewRoute()) return path;
  return PREVIEW_PATHS[path] ?? "/preview";
}

/** Address editor path for the current preview mode. */
export function previewAddressPath(id: string) {
  if (!isPreviewRoute()) return `/addresses/${id}`;
  return `/preview/addresses/${id}`;
}

/** Book flow path for the current preview mode. */
export function previewBookPath(providerId: string) {
  if (!isPreviewRoute()) return `/book/${providerId}`;
  return `/preview/book/${providerId}`;
}
