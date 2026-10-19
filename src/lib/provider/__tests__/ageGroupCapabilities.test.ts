import { describe, expect, it } from "vitest";
import {
  buildAgeGroupCapabilitiesPayload,
  buildAgeGroupCapabilitiesPayloadFromChips,
  chipHasVerifiedCode,
  chipIsSelected,
  expandChipsToCatalogueCodes,
  hydrateChipIdsFromCapabilities,
  mapCapabilitiesFromSnapshot,
} from "@/lib/provider/ageGroupCapabilities";

describe("ageGroupCapabilities helpers", () => {
  it("maps snapshot rows and builds a de-duplicated save payload", () => {
    const forms = mapCapabilitiesFromSnapshot([
      { code: "toddler", years_experience: 2, note: "naps", verified_at: "2026-01-01" },
      { code: "  ", years_experience: 1, note: null, verified_at: null },
    ]);
    expect(forms).toEqual([{ code: "toddler", years_experience: 2, note: "naps", verified: true }]);
    expect(
      buildAgeGroupCapabilitiesPayload(
        ["toddler", "toddler", "infant"],
        [...forms, { code: "infant", years_experience: null, note: "  ", verified: false }],
      ),
    ).toEqual([
      { code: "toddler", years_experience: 2, note: "naps" },
      { code: "infant", years_experience: null, note: null },
    ]);
  });

  it("expands the four UI chips into six catalogue codes", () => {
    expect(expandChipsToCatalogueCodes(["infants", "kids", "teens"])).toEqual([
      "newborn",
      "infant",
      "preschool",
      "school_age",
      "teenager",
    ]);
  });

  it("hydrates chip ids from saved capability rows and respects verified locks", () => {
    const forms = mapCapabilitiesFromSnapshot([
      { code: "infant", years_experience: 3, note: "", verified_at: "2026-01-01" },
      { code: "school_age", years_experience: 1, note: "", verified_at: null },
    ]);
    expect(hydrateChipIdsFromCapabilities(forms)).toEqual(["infants", "kids"]);
    expect(chipHasVerifiedCode("infants", forms)).toBe(true);
    expect(chipIsSelected("infants", [], forms)).toBe(true);
    expect(chipIsSelected("teens", [], forms)).toBe(false);
  });

  it("builds a six-code payload from chips with shared years and note", () => {
    expect(
      buildAgeGroupCapabilitiesPayloadFromChips(
        ["infants", "toddlers"],
        [{ code: "infant", years_experience: 9, note: "old", verified: true }],
        4,
        "shared note",
      ),
    ).toEqual([
      { code: "newborn", years_experience: 4, note: "shared note" },
      { code: "infant", years_experience: 4, note: "shared note" },
      { code: "toddler", years_experience: 4, note: "shared note" },
    ]);
  });
});
