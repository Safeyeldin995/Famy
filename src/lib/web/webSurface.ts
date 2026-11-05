/** Public web allowlist: landing, legal, admin staff entry, app-deeplink helpers, APIs. */

export const ACCOUNT_DELETE_INTENT = "account-delete";

export type WebSurfaceOptions = {
  previewRoutesEnabled: boolean;
};

export function normalizeWebPathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function webSurfaceSearchParams(
  search: string | Record<string, unknown> | undefined,
): URLSearchParams {
  if (!search) return new URLSearchParams();
  if (typeof search === "string") {
    const raw = search.startsWith("?") ? search.slice(1) : search;
    return new URLSearchParams(raw);
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) params.append(key, String(item));
      }
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

export function hasAccountDeleteIntent(params: URLSearchParams): boolean {
  return params.get("intent") === ACCOUNT_DELETE_INTENT;
}

export function isAccountDeletionAuthPath(pathname: string): boolean {
  const path = normalizeWebPathname(pathname);
  return (
    path === "/login" ||
    path === "/otp" ||
    path === "/auth/set-password" ||
    path === "/auth/forgot" ||
    path === "/auth/callback"
  );
}

/** True when this URL may load on the public website (not redirected to `/`). */
export function isWebSurfacePathAllowed(
  pathname: string,
  search: string | Record<string, unknown> | undefined,
  options: WebSurfaceOptions,
): boolean {
  const path = normalizeWebPathname(pathname);
  const params = webSurfaceSearchParams(search);

  if (path.startsWith("/api/")) return true;

  if (options.previewRoutesEnabled && (path === "/preview" || path.startsWith("/preview/"))) {
    return true;
  }

  if (path === "/") return true;
  if (path === "/about" || path === "/contact" || path === "/help") return true;
  if (path === "/staff") return true;
  if (path.startsWith("/admin")) return true;
  if (path === "/account/delete") return true;
  if (path.startsWith("/content/")) return true;
  if (path === "/auth/callback") return true;
  if (path.startsWith("/provider/")) return true;

  if (path.startsWith("/booking/")) {
    return params.get("paymob_return") === "1";
  }

  if (isAccountDeletionAuthPath(path) && hasAccountDeleteIntent(params)) {
    return true;
  }

  return false;
}
