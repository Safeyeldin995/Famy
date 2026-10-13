import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { adminLocationLabel } from "../adminLocationLabel";

const t = ((key: string, options: { defaultValue: string }) =>
  key === "adminReview.locationNames.giza" ? "الجيزة" : options.defaultValue) as TFunction;

describe("admin location display labels", () => {
  it("prefers an assigned zone Arabic name", () => {
    expect(
      adminLocationLabel("Sheikh Zayed", "ar", t, [
        { name_en: "Sheikh Zayed", name_ar: "الشيخ زايد" },
      ]),
    ).toBe("الشيخ زايد");
  });

  it("uses the localized fallback without changing stored data", () => {
    expect(adminLocationLabel("Giza", "ar", t)).toBe("الجيزة");
    expect(adminLocationLabel("Giza", "en", t)).toBe("Giza");
    expect(adminLocationLabel("Unknown area", "ar", t)).toBe("Unknown area");
  });
});
