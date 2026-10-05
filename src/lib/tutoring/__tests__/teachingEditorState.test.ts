import { expect, it } from "vitest";
import { teachingMissingChoice, taxonomyState } from "../teachingEditorState";

it("names the next required choice in order and permits saving only when complete", () => {
  expect(teachingMissingChoice("", "", [], false)).toBe("subject");
  expect(teachingMissingChoice("subject", "", [], false)).toBe("curriculum");
  expect(teachingMissingChoice("subject", "curriculum", [], false)).toBe("level");
  expect(teachingMissingChoice("subject", "curriculum", ["level"], false)).toBe("price");
  expect(teachingMissingChoice("subject", "curriculum", ["level"], true)).toBeNull();
});
it("never describes a failed or loading taxonomy as empty, even with stale data", () => {
  for (const count of [0, 1]) {
    expect(taxonomyState({ isError: true }, count)).toBe("error");
    expect(taxonomyState({ isLoading: true }, count)).toBe("loading");
  }
  expect(taxonomyState({}, 0)).toBe("empty");
  expect(taxonomyState({}, 1)).toBe("ready");
});
