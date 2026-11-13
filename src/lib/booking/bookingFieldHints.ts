import type { CustomerBookingStep } from "./customerSteps";
import type { BookingScreen } from "./bookingScreens";
import { bookingScreenForStep } from "./bookingScreens";

export type BookingFieldHint = {
  screen: BookingScreen;
  messageKey: string;
  focusId: string;
};

export function bookingFieldHintForStep(
  step: CustomerBookingStep,
  tutoring: boolean,
): BookingFieldHint | null {
  const screen = bookingScreenForStep(step, tutoring);
  const map: Partial<Record<CustomerBookingStep, Omit<BookingFieldHint, "screen">>> = {
    service: { messageKey: "bookingUx.chooseService", focusId: "booking-services" },
    duration: { messageKey: "bookingUx.chooseSession", focusId: "booking-services" },
    schedule: { messageKey: "bookingUx.chooseTime", focusId: "booking-schedule" },
    address: { messageKey: "bookingUx.chooseAddress", focusId: "booking-addresses" },
    forWhom: { messageKey: "bookingUx.chooseRecipient", focusId: "booking-recipient" },
    requirements: { messageKey: "bookingUx.chooseRequirements", focusId: "booking-requirements" },
    payment: { messageKey: "bookingUx.choosePayment", focusId: "booking-payment" },
  };
  const hit = map[step];
  if (!hit) return null;
  return { screen, ...hit };
}
