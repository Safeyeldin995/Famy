import { expect, it } from "vitest";
import { buildCustomerBookingSteps, resolveCustomerBookingStep } from "../customerSteps";
const hourly = {
  tutoring: false,
  fixedPackage: false,
  requirementsSuccess: true,
  requirementsCount: 0,
};
it("removes notes and only successfully empty requirements", () => {
  expect(buildCustomerBookingSteps(hourly)).toEqual([
    "service",
    "duration",
    "schedule",
    "address",
    "forWhom",
    "summary",
    "payment",
  ]);
  for (const state of [
    { requirementsSuccess: false, requirementsCount: 0 },
    { requirementsSuccess: true, requirementsCount: undefined },
    { requirementsSuccess: true, requirementsCount: 1 },
  ]) {
    expect(buildCustomerBookingSteps({ ...hourly, ...state })).toContain("requirements");
  }
});
it("skips fixed duration but preserves tutoring ordering and required choices", () => {
  expect(buildCustomerBookingSteps({ ...hourly, fixedPackage: true })).not.toContain("duration");
  expect(
    buildCustomerBookingSteps({
      ...hourly,
      tutoring: true,
      fixedPackage: true,
      requirementsCount: 1,
    }),
  ).toEqual([
    "service",
    "forWhom",
    "duration",
    "schedule",
    "address",
    "requirements",
    "summary",
    "payment",
  ]);
});
it("keeps logical screens stable as query results arrive", () => {
  const steps = buildCustomerBookingSteps(hourly);
  expect(resolveCustomerBookingStep("requirements", steps)).toBe("summary");
  expect(resolveCustomerBookingStep("payment", steps)).toBe("payment");
  expect(
    resolveCustomerBookingStep(
      "duration",
      buildCustomerBookingSteps({ ...hourly, fixedPackage: true }),
    ),
  ).toBe("schedule");
});
