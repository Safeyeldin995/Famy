export type CustomerBookingStep =
  | "service"
  | "duration"
  | "schedule"
  | "address"
  | "forWhom"
  | "requirements"
  | "summary"
  | "payment";
export function buildCustomerBookingSteps(input: {
  tutoring: boolean;
  fixedPackage: boolean;
  requirementsSuccess: boolean;
  requirementsCount?: number;
}): CustomerBookingStep[] {
  const steps: CustomerBookingStep[] = input.tutoring
    ? ["service", "forWhom", "duration", "schedule", "address"]
    : [
        "service",
        ...(input.fixedPackage ? [] : ["duration" as const]),
        "schedule",
        "address",
        "forWhom",
      ];
  if (!input.requirementsSuccess || input.requirementsCount !== 0) steps.push("requirements");
  return [...steps, "summary", "payment"];
}
/** Keep the current logical screen stable when async requirements remove an earlier stop. */
export function resolveCustomerBookingStep(
  step: CustomerBookingStep,
  steps: CustomerBookingStep[],
): CustomerBookingStep {
  if (steps.includes(step)) return step;
  return step === "duration" ? "schedule" : step === "requirements" ? "summary" : steps[0];
}
