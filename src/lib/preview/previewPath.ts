import { isPreviewRoute } from "@/lib/preview/constants";

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
