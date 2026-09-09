/** Stable fake user id for design-preview routes (no real Supabase session). */
export const PREVIEW_USER_ID = "preview-user-00000000-0000-0000-0000-000000000001";

/** Preview provider profile reused across customer + pro preview screens. */
export const PREVIEW_PROVIDER_ID = "p1";

export function isPreviewRoute(pathname = typeof window !== "undefined" ? window.location.pathname : "") {
  return pathname === "/preview" || pathname.startsWith("/preview/");
}

export function isPreviewProRoute(pathname = typeof window !== "undefined" ? window.location.pathname : "") {
  return pathname === "/preview/pro" || pathname.startsWith("/preview/pro/");
}
