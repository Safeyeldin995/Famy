import { describe, expect, it } from "vitest";
import {
  buildAgeGroupCapabilitiesPayload,
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
});
