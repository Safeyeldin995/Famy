import { describe, expect, it } from "vitest";
import { sanitizeStoreUrlForClient, validateStoreLinksSettings } from "../storeLinks";

describe("validateStoreLinksSettings", () => {
  it("allows empty URLs", () => {
    expect(validateStoreLinksSettings({ play_url: "", app_store_url: "" })).toEqual([]);
  });

  it("requires official store hosts", () => {
    const errors = validateStoreLinksSettings({
      play_url: "https://example.com/app",
      app_store_url: "https://apps.apple.com/app/id123",
    });
    expect(errors).toEqual([{ field: "play_url", code: "invalid_url" }]);
  });
});

describe("sanitizeStoreUrlForClient", () => {
  it("rejects non-store https URLs", () => {
    expect(sanitizeStoreUrlForClient("android", { play_url: "javascript:alert(1)" })).toBeNull();
    expect(sanitizeStoreUrlForClient("android", { play_url: "https://evil.com/x" })).toBeNull();
  });

  it("accepts configured store URLs", () => {
    expect(
      sanitizeStoreUrlForClient("android", {
        play_url: "https://play.google.com/store/apps/details?id=com.famy.app",
      }),
    ).toContain("play.google.com");
  });
});