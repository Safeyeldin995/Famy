import { describe, expect, it } from "vitest";
import { shouldClearStaleEducationLevel } from "../educationProfileFieldsLogic";

describe("education profile field validation", () => {
  it("does not clear a saved grade while taxonomy is still loading", () => {
    expect(
      shouldClearStaleEducationLevel({
        educationLevelId: "lvl-10",
        filteredLevelIds: [],
        taxonomyLoaded: false,
      }),
    ).toBe(false);
  });

  it("clears a grade only after taxonomy loaded and the id is invalid", () => {
    expect(
      shouldClearStaleEducationLevel({
        educationLevelId: "lvl-10",
        filteredLevelIds: ["lvl-9"],
        taxonomyLoaded: true,
      }),
    ).toBe(true);
    expect(
      shouldClearStaleEducationLevel({
        educationLevelId: "lvl-10",
        filteredLevelIds: ["lvl-10"],
        taxonomyLoaded: true,
      }),
    ).toBe(false);
  });
});
