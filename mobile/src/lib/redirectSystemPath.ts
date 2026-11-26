const APP_LINK_HOST = "famy-chi.vercel.app";

function pathnameAndSearch(rawPath: string): { pathname: string; search: string } {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return { pathname: "/", search: "" };
  }
  try {
    if (trimmed.includes("://")) {
      const url = new URL(trimmed);
      if (url.protocol === "famy:") {
        const path = `/${url.hostname}${url.pathname}`;
        return { pathname: path || "/", search: url.search };
      }
      return { pathname: url.pathname || "/", search: url.search };
    }
  } catch {
    // Fall through: treat as a path fragment.
  }
  const q = trimmed.indexOf("?");
  if (q >= 0) {
    return { pathname: trimmed.slice(0, q) || "/", search: trimmed.slice(q) };
  }
  return { pathname: trimmed.startsWith("/") ? trimmed : `/${trimmed}`, search: "" };
}

function isUniversalHost(hostname: string): boolean {
  return hostname === APP_LINK_HOST || hostname === `www.${APP_LINK_HOST}`;
}

/**
 * Rewrites incoming HTTPS universal-link paths into Expo Router routes.
 * Pure function for unit tests and +native-intent.
 */
export function rewriteIncomingAppLinkPath(rawPath: string): string {
  const { pathname, search } = pathnameAndSearch(rawPath);
  let host = "";
  try {
    if (rawPath.includes("://")) {
      host = new URL(rawPath).hostname;
    }
  } catch {
    host = "";
  }

  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "p" && segments[1]) {
    return `/provider/${segments[1]}${search}`;
  }

  if (segments[0] === "online" && segments[1] === "lessons" && segments[2]) {
    const bookingId = segments[2];
    if (segments[3] === "room") {
      return `/lesson-link/${bookingId}${search}`;
    }
    return `/booking/${bookingId}${search}`;
  }

  if (segments[0] === "booking" && segments[1]) {
    return `${pathname}${search}`;
  }

  if (segments[0] === "provider" && segments[1]) {
    return `${pathname}${search}`;
  }

  if (host && isUniversalHost(host)) {
    return "/";
  }

  if (pathname === "/" || segments.length === 0) {
    return "/";
  }

  return `${pathname}${search}`;
}