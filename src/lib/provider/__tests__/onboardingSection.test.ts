import { expect, it } from "vitest";
import { onboardingSection, onboardingInitialStep } from "../onboardingSection";
import { pendingHomeModel } from "../pendingHomeModel";

it("documents target opens review while missing and invalid targets start at step one", () => {
  expect(onboardingSection({ section: "review" })).toEqual({ section: "review" });
  expect(onboardingInitialStep(onboardingSection({ section: "review" }).section)).toBe(5);
  for (const section of [undefined, "invalid", ["review"]]) {
    expect(onboardingSection({ section })).toEqual({});
    expect(onboardingInitialStep(section)).toBe(0);
  }
});

it("opens every checklist section directly", () => {
  for (const [index, section] of ["personal", "services", "experience", "coverage", "references", "review"].entries()) {
    expect(onboardingSection({ section })).toEqual({ section });
    expect(onboardingInitialStep(section)).toBe(index);
  }
});

it("opens every pending-home task in its existing editable section", () => {
  const model = pendingHomeModel({ photo: true, about: false, personal: false, reference: true, babysitting: false, needsBabysitting: true, subjects: false, needsSubjects: true });
  expect(model.items.map(({ key, section }) => [key, onboardingInitialStep(onboardingSection({ section }).section)])).toEqual([
    ["photo", 0], ["about", 2], ["babysitting", 2], ["subjects", 1], ["reference", 4], ["personal", 0],
  ]);
});
