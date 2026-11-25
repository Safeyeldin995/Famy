import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_RELEASE,
  appStoreUpdateUrl,
  compareAppVersions,
  decideAppRelease,
  parseAppReleaseSettings,
  validateAppReleaseSettings,
  type AppReleaseSettings,
} from "../appRelease";

const base: AppReleaseSettings = {
  ...DEFAULT_APP_RELEASE,
  min_version_android: "1.2.0",
  latest_version_android: "1.4.0",
  min_version_ios: "1.1.0",
  latest_version_ios: "1.3.0",
};

describe("compareAppVersions", () => {
  it("orders by major, minor, patch numerically", () => {
    expect(compareAppVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareAppVersions("1.0.9", "1.0.10")).toBe(-1);
    expect(compareAppVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareAppVersions("2.0.0", "1.99.99")).toBe(1);
  });
  it("treats missing or malformed parts as zero instead of throwing", () => {
    expect(compareAppVersions("1.2", "1.2.0")).toBe(0);
    expect(compareAppVersions(undefined, "0.0.0")).toBe(0);
    expect(compareAppVersions("abc", "1.0.0")).toBe(-1);
  });
});

describe("decideAppRelease", () => {
  it("lets the user in when the settings could not be loaded", () => {
    expect(decideAppRelease(null, "0.0.1", "android", "ar")).toEqual({ kind: "ok" });
  });
  it("puts maintenance above every version rule", () => {
    const s = { ...base, maintenance: true, maintenance_message_ar: " تحديث " };
    expect(decideAppRelease(s, "0.1.0", "android", "ar")).toEqual({
      kind: "maintenance",
      message: "تحديث",
    });
    expect(decideAppRelease(s, "9.0.0", "ios", "en")).toEqual({ kind: "maintenance", message: "" });
  });
  it("forces an update below the platform minimum", () => {
    expect(decideAppRelease(base, "1.1.9", "android", "ar")).toEqual({ kind: "force_update" });
    expect(decideAppRelease(base, "1.1.9", "ios", "ar")).toEqual({
      kind: "soft_update",
      latest: "1.3.0",
    });
  });
  it("suggests an update between minimum and latest, and is ok at latest", () => {
    expect(decideAppRelease(base, "1.2.0", "android", "ar")).toEqual({
      kind: "soft_update",
      latest: "1.4.0",
    });
    expect(decideAppRelease(base, "1.4.0", "android", "ar")).toEqual({ kind: "ok" });
    expect(decideAppRelease(base, "1.5.0", "android", "ar")).toEqual({ kind: "ok" });
  });
  it("never blocks when the app version itself is unknown", () => {
    expect(decideAppRelease(base, undefined, "android", "ar")).toEqual({ kind: "ok" });
  });
});

describe("parseAppReleaseSettings", () => {
  it("falls back to safe defaults for malformed values", () => {
    expect(
      parseAppReleaseSettings({
        min_version_android: "x",
        maintenance: "yes",
        maintenance_message_ar: 5,
      }),
    ).toEqual(DEFAULT_APP_RELEASE);
    expect(parseAppReleaseSettings(null)).toEqual(DEFAULT_APP_RELEASE);
  });
});

describe("validateAppReleaseSettings", () => {
  it("accepts a valid value", () => {
    expect(validateAppReleaseSettings(base)).toEqual([]);
  });
  it("rejects bad versions, minimum above latest, and long messages", () => {
    const errors = validateAppReleaseSettings({
      ...base,
      min_version_ios: "1.0",
      min_version_android: "2.0.0",
      maintenance_message_en: "x".repeat(301),
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        { field: "min_version_ios", code: "invalid_version" },
        { field: "min_version_android", code: "min_above_latest" },
        { field: "maintenance_message_en", code: "too_long" },
      ]),
    );
  });
});

describe("appStoreUpdateUrl", () => {
  it("uses configured https store links and safe fallbacks", () => {
    expect(appStoreUpdateUrl("android", { play_url: "https://play.google.com/x" })).toBe(
      "https://play.google.com/x",
    );
    expect(appStoreUpdateUrl("android", { play_url: "javascript:alert(1)" })).toBe(
      "market://details?id=com.famy.app",
    );
    expect(appStoreUpdateUrl("ios", null)).toBeNull();
    expect(appStoreUpdateUrl("ios", { app_store_url: "https://apps.apple.com/app/id123" })).toBe(
      "https://apps.apple.com/app/id123",
    );
  });
});
