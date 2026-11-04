import type { CustomerBookingStep } from "./customerSteps";
export function bookingDisabledReason(input: {
  step: CustomerBookingStep;
  allowed: boolean;
  submitting: boolean;
  loading?: boolean;
  error?: boolean;
  hasDate?: boolean;
  hasSlots?: boolean;
  hasAddress?: boolean;
  supervisionRequired?: boolean;
  hasSupervision?: boolean;
  hasRecipient?: boolean;
}): string | null {
  if (input.submitting) return "bookingUx.saving";
  if (input.allowed) return null;
  if (input.error) return "bookingUx.retryLoad";
  if (input.loading) return "bookingUx.loading";
  switch (input.step) {
    case "service":
      return "bookingUx.chooseService";
    case "duration":
      return "bookingUx.chooseSession";
    case "schedule":
      return !input.hasDate
        ? "bookingUx.chooseDate"
        : !input.hasSlots
          ? "bookingUx.noSlots"
          : "bookingUx.chooseTime";
    case "address":
      return !input.hasAddress ? "bookingUx.chooseAddress" : "bookingUx.outsideArea";
    case "forWhom":
      if (input.hasRecipient === false) return "bookingUx.chooseRecipient";
      if (input.supervisionRequired && !input.hasSupervision) return "bookingUx.chooseSupervision";
      return "bookingUx.chooseRecipient";
    case "requirements":
      return "bookingUx.chooseRequirements";
    case "payment":
      return "bookingUx.choosePayment";
    default:
      return "bookingUx.reviewChoices";
  }
}
