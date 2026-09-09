import { afterEach, describe, expect, it } from "vitest";
import { isPreviewRoutesEnabled } from "@/lib/preview/previewRoutes.server";

describe("isPreviewRoutesEnabled", () => {
  const original = process.env.PREVIEW_ROUTES_ENABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PREVIEW_ROUTES_ENABLED;
    } else {
      process.env.PREVIEW_ROUTES_ENABLED = original;
    }
  });

  it("is off when PREVIEW_ROUTES_ENABLED is unset", () => {
    delete process.env.PREVIEW_ROUTES_ENABLED;
    expect(isPreviewRoutesEnabled()).toBe(false);
  });

  it("is on only when PREVIEW_ROUTES_ENABLED is exactly true", () => {
    process.env.PREVIEW_ROUTES_ENABLED = "true";
    expect(isPreviewRoutesEnabled()).toBe(true);
  });

  it("is off for truthy-looking but non-exact values", () => {
    process.env.PREVIEW_ROUTES_ENABLED = "1";
    expect(isPreviewRoutesEnabled()).toBe(false);

    process.env.PREVIEW_ROUTES_ENABLED = "TRUE";
    expect(isPreviewRoutesEnabled()).toBe(false);

    process.env.PREVIEW_ROUTES_ENABLED = "false";
    expect(isPreviewRoutesEnabled()).toBe(false);
  });
});
