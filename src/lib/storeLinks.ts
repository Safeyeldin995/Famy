export type StoreLinksSettings = {
  play_url: string;
  app_store_url: string;
};

export type StoreLinksValidationError =
  | { field: "play_url"; code: "invalid_url" }
  | { field: "app_store_url"; code: "invalid_url" };

function isHttpsPlayStoreUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "play.google.com";
  } catch {
    return false;
  }
}

function isHttpsAppStoreUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "apps.apple.com";
  } catch {
    return false;
  }
}

export function validateStoreLinksSettings(s: StoreLinksSettings): StoreLinksValidationError[] {
  const errors: StoreLinksValidationError[] = [];
  const play = s.play_url.trim();
  const apple = s.app_store_url.trim();
  if (play && !isHttpsPlayStoreUrl(play)) {
    errors.push({ field: "play_url", code: "invalid_url" });
  }
  if (apple && !isHttpsAppStoreUrl(apple)) {
    errors.push({ field: "app_store_url", code: "invalid_url" });
  }
  return errors;
}

export function sanitizeStoreUrlForClient(
  platform: "android" | "ios",
  storeLinks: { play_url?: unknown; app_store_url?: unknown } | null | undefined,
): string | null {
  const raw = platform === "ios" ? storeLinks?.app_store_url : storeLinks?.play_url;
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url) return null;
  if (platform === "ios") return isHttpsAppStoreUrl(url) ? url : null;
  return isHttpsPlayStoreUrl(url) ? url : null;
}