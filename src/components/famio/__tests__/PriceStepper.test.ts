import { expect, it } from "vitest";
import { initialStepperPrice, stepperPrice } from "../PriceStepper";
it("starts at a snapped midpoint and keeps endpoints reachable", () => {
  expect(initialStepperPrice(120, 600)).toBe(350);
  expect(stepperPrice(120, 1, 120, 600)).toBe(150);
  expect(stepperPrice(150, -1, 120, 600)).toBe(120);
  expect(stepperPrice(575, 1, 120, 590)).toBe(590);
  expect(stepperPrice(590, 1, 120, 590)).toBe(590);
  expect(stepperPrice(120, -1, 120, 590)).toBe(120);
});
it("supports narrow and equal limits and the unbounded 50-step fallback", () => {
  expect(initialStepperPrice(121, 123)).toBe(121);
  expect(initialStepperPrice(100, 100)).toBe(100);
  expect(initialStepperPrice(null, null)).toBe(50);
  expect(stepperPrice(50, -1, null, null)).toBe(50);
  expect(stepperPrice(50, 1, null, null)).toBe(100);
  expect(stepperPrice(100, 1, null, 120)).toBe(120);
});
