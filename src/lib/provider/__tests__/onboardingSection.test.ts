import { expect, it } from "vitest";
import { onboardingSection, onboardingInitialStep } from "../onboardingSection";

it("documents target opens review while missing and invalid targets start at step one", () => {
  expect(onboardingSection({ section: "review" })).toEqual({ section: "review" });
  expect(onboardingInitialStep(onboardingSection({ section: "review" }).section)).toBe(5);
  for (const section of [undefined, "personal", "invalid", ["review"]]) {
    expect(onboardingSection({ section })).toEqual({});
    expect(onboardingInitialStep(section)).toBe(0);
  }
});
