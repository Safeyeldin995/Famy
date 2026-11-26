import { sanitizeStoreUrlForClient, type StoreLinksSettings } from "./storeLinks";

/**
 * App release gate: minimum / latest app versions and maintenance mode.
 * Stored in `settings.app_release`; shared by the mobile launch check and the admin form.
 * Pure helpers only (no I/O) so both apps and the tests use the same rules.
 */

export type AppReleaseSettings = {
  min_version_android: string;
  min_version_ios: string;
  latest_version_android: string;
  latest_version_ios: string;
  maintenance: boolean;
  maintenance_message_ar: string;
  maintenance_message_en: string;
};

export const DEFAULT_APP_RELEASE: AppReleaseSettings = {
  min_version_android: "1.0.0",
  min_version_ios: "1.0.0",
  latest_version_android: "1.0.0",
  latest_version_ios: "1.0.0",
  maintenance: false,
  maintenance_message_ar: "",
  maintenance_message_en: "",
};

export const APP_RELEASE_MESSAGE_MAX = 300;

const SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

export function isValidAppVersion(value: string | null | undefined): boolean {
  return typeof value === "string" && SEMVER_RE.test(value.trim());
}

/**
 * Compares two "major.minor.patch" versions. Missing or non-numeric parts count as 0,
 * so a malformed version never throws. Returns -1, 0 or 1.
 */
export function compareAppVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const parse = (v: string | null | undefined) =>
    String(v ?? "")
      .trim()
      .split(/[.+-]/)
      .slice(0, 3)
      .map((p) => {
        const n = Number.parseInt(p, 10);
        return Number.isFinite(n) && n >= 0 ? n : 0;
      });
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Reads a stored value defensively: anything malformed falls back to the safe default. */
export function parseAppReleaseSettings(
  value: Record<string, unknown> | null | undefined,
): AppReleaseSettings {
  const v = value ?? {};
  const version = (key: keyof AppReleaseSettings) => {
    const raw = v[key];
    return typeof raw === "string" && isValidAppVersion(raw)
      ? raw.trim()
      : (DEFAULT_APP_RELEASE[key] as string);
  };
  const text = (key: keyof AppReleaseSettings) =>
    typeof v[key] === "string" ? (v[key] as string).slice(0, APP_RELEASE_MESSAGE_MAX) : "";
  return {
    min_version_android: version("min_version_android"),
    min_version_ios: version("min_version_ios"),
    latest_version_android: version("latest_version_android"),
    latest_version_ios: version("latest_version_ios"),
    maintenance: v.maintenance === true,
    maintenance_message_ar: text("maintenance_message_ar"),
    maintenance_message_en: text("maintenance_message_en"),
  };
}

export type AppReleasePlatform = "android" | "ios";

export type AppReleaseDecision =
  | { kind: "ok" }
  | { kind: "maintenance"; message: string }
  | { kind: "force_update" }
  | { kind: "soft_update"; latest: string };

/**
 * Launch decision, in priority order: maintenance > force update > soft update > ok.
 * `settings === null` (fetch failed or timed out) always lets the user in.
 */
export function decideAppRelease(
  settings: AppReleaseSettings | null,
  appVersion: string | null | undefined,
  platform: AppReleasePlatform,
  lang: string,
): AppReleaseDecision {
  if (!settings) return { kind: "ok" };
  if (settings.maintenance) {
    const message =
      lang === "en" ? settings.maintenance_message_en : settings.maintenance_message_ar;
    return { kind: "maintenance", message: message.trim() };
  }
  if (!isValidAppVersion(appVersion ?? "")) return { kind: "ok" };
  const min = platform === "ios" ? settings.min_version_ios : settings.min_version_android;
  const latest = platform === "ios" ? settings.latest_version_ios : settings.latest_version_android;
  if (compareAppVersions(appVersion, min) < 0) return { kind: "force_update" };
  if (compareAppVersions(appVersion, latest) < 0) return { kind: "soft_update", latest };
  return { kind: "ok" };
}

export type AppReleaseValidationError =
  | { field: keyof AppReleaseSettings; code: "invalid_version" }
  | { field: "min_version_android" | "min_version_ios"; code: "min_above_latest" }
  | { field: "maintenance_message_ar" | "maintenance_message_en"; code: "too_long" }
  | { field: "play_url" | "app_store_url"; code: "store_link_required" };

export type AppReleaseSettingsPayload = {
  release: AppReleaseSettings;
  storeLinks: StoreLinksSettings;
  previousRelease?: AppReleaseSettings | null;
};

/** Admin form validation. Empty list means the value is safe to save. */
export function validateAppReleaseSettings(s: AppReleaseSettings): AppReleaseValidationError[] {
  const errors: AppReleaseValidationError[] = [];
  const versionFields = [
    "min_version_android",
    "min_version_ios",
    "latest_version_android",
    "latest_version_ios",
  ] as const;
  for (const f of versionFields) {
    if (!isValidAppVersion(s[f])) errors.push({ field: f, code: "invalid_version" });
  }
  if (
    isValidAppVersion(s.min_version_android) &&
    isValidAppVersion(s.latest_version_android) &&
    compareAppVersions(s.min_version_android, s.latest_version_android) > 0
  ) {
    errors.push({ field: "min_version_android", code: "min_above_latest" });
  }
  if (
    isValidAppVersion(s.min_version_ios) &&
    isValidAppVersion(s.latest_version_ios) &&
    compareAppVersions(s.min_version_ios, s.latest_version_ios) > 0
  ) {
    errors.push({ field: "min_version_ios", code: "min_above_latest" });
  }
  if (s.maintenance_message_ar.length > APP_RELEASE_MESSAGE_MAX) {
    errors.push({ field: "maintenance_message_ar", code: "too_long" });
  }
  if (s.maintenance_message_en.length > APP_RELEASE_MESSAGE_MAX) {
    errors.push({ field: "maintenance_message_en", code: "too_long" });
  }
  return errors;
}

/** Admin save: raising a platform minimum requires that platform's store URL. */
export function validateAppReleaseAdminSave(
  payload: AppReleaseSettingsPayload,
): AppReleaseValidationError[] {
  const errors = validateAppReleaseSettings(payload.release);
  const prev = payload.previousRelease;
  if (!prev) return errors;
  const links = payload.storeLinks;
  if (
    compareAppVersions(payload.release.min_version_ios, prev.min_version_ios) > 0 &&
    !links.app_store_url.trim()
  ) {
    errors.push({ field: "app_store_url", code: "store_link_required" });
  }
  if (
    compareAppVersions(payload.release.min_version_android, prev.min_version_android) > 0 &&
    !links.play_url.trim()
  ) {
    errors.push({ field: "play_url", code: "store_link_required" });
  }
  return errors;
}

export const APP_RELEASE_CACHE_SCHEMA = 1;

export type CachedAppReleaseSnapshot = {
  schema: number;
  savedAt: number;
  release: AppReleaseSettings;
  storeLinks: { play_url: string; app_store_url: string };
};

export function serializeAppReleaseCache(snapshot: CachedAppReleaseSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseAppReleaseCache(raw: string | null | undefined): CachedAppReleaseSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedAppReleaseSnapshot;
    if (parsed.schema !== APP_RELEASE_CACHE_SCHEMA) return null;
    if (!parsed.release || typeof parsed.savedAt !== "number") return null;
    return {
      schema: APP_RELEASE_CACHE_SCHEMA,
      savedAt: parsed.savedAt,
      release: parseAppReleaseSettings(parsed.release as unknown as Record<string, unknown>),
      storeLinks: {
        play_url: typeof parsed.storeLinks?.play_url === "string" ? parsed.storeLinks.play_url : "",
        app_store_url:
          typeof parsed.storeLinks?.app_store_url === "string" ? parsed.storeLinks.app_store_url : "",
      },
    };
  } catch {
    return null;
  }
}

export function resolveAppReleaseFetch(
  fetched: { release: AppReleaseSettings; storeLinks: Record<string, unknown> | null } | null,
  cached: CachedAppReleaseSnapshot | null,
): { release: AppReleaseSettings; storeLinks: Record<string, unknown> | null } | null {
  if (fetched) return fetched;
  if (!cached) return null;
  return {
    release: cached.release,
    storeLinks: cached.storeLinks,
  };
}

/**
 * Store page for the update button. Uses settings.store_links when present.
 * iOS has no usable fallback (the App Store needs the numeric app id), so it
 * returns null and the gate must fail open instead of trapping the user.
 */
export function appStoreUpdateUrl(
  platform: AppReleasePlatform,
  storeLinks: { play_url?: unknown; app_store_url?: unknown } | null | undefined,
): string | null {
  if (platform === "ios") {
    return sanitizeStoreUrlForClient("ios", storeLinks);
  }
  return sanitizeStoreUrlForClient("android", storeLinks) ?? "market://details?id=com.famy.app";
}
