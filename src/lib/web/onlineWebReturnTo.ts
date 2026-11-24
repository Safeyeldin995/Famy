import { ONLINE_WEB_ROUTE_IDS } from "./onlineWebSurface";

const STORAGE_KEY = "famy_online_web_return_to";

export function stashOnlineWebReturnTo(path: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    /* ignore quota */
  }
}

export function peekOnlineWebReturnTo(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function consumeOnlineWebReturnTo(fallback = ONLINE_WEB_ROUTE_IDS.tutors): string {
  const path = peekOnlineWebReturnTo() ?? fallback;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  return path;
}