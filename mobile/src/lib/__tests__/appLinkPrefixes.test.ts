import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  ANDROID_APP_LINK_PATH_PREFIXES,
  pathMatchesAndroidAppLinkPrefix,
} = require("../../../appLinkPrefixes");

describe("Android app link pathPrefix", () => {
  it("uses trailing slashes to avoid broad prefixes", () => {
    expect(ANDROID_APP_LINK_PATH_PREFIXES).toEqual([
      "/booking/",
      "/online/lessons/",
      "/p/",
      "/provider/",
    ]);
  });

  it("matches intended deep-link paths", () => {
    expect(pathMatchesAndroidAppLinkPrefix("/p/abc")).toBe(true);
    expect(pathMatchesAndroidAppLinkPrefix("/booking/123")).toBe(true);
    expect(pathMatchesAndroidAppLinkPrefix("/online/lessons/123/room")).toBe(true);
  });

  it("does not match unrelated site routes", () => {
    for (const path of ["/pay/fees-return", "/pro/x", "/privacy", "/bookings", "/providers"]) {
      expect(pathMatchesAndroidAppLinkPrefix(path)).toBe(false);
    }
  });
});