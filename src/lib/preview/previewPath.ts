import { isPreviewRoute } from "@/lib/preview/constants";

const PREVIEW_PATHS: Record<string, string> = {
  "/home": "/preview/home",
  "/search": "/preview/search",
  "/profile": "/preview/profile",
  "/messages": "/preview/messages",
  "/addresses": "/preview/addresses",
  "/bookings": "/preview/bookings",
  "/notifications": "/preview/notifications",
  "/family-members": "/preview/profile",
};

/** Rewrites in-app paths to their /preview/* equivalents when browsing the design preview. */
export function previewPath(path: string) {
  if (!isPreviewRoute()) return path;
  return PREVIEW_PATHS[path] ?? "/preview";
}
