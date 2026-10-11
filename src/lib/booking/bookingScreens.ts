import type { CustomerBookingStep } from "./customerSteps";
import type { TeachingCapabilityOption } from "@/lib/tutoring/teachingCapabilities";

export const BOOKING_SCREENS = ["service", "when", "whereWho", "review"] as const;
export type BookingScreen = (typeof BOOKING_SCREENS)[number];

/** Aggregate the original gates, without dropping a check when its old step disappears. */
export function bookingScreenMissingStep(
  screen: BookingScreen,
  input: {
    service: boolean;
    tutoring: boolean;
    capability: boolean;
    slot: boolean;
    address: boolean;
    recipient: boolean;
    requirements: boolean;
    payment: boolean;
  },
): CustomerBookingStep | null {
  if (!input.service) return "service";
  if (input.tutoring && !input.recipient) return "forWhom";
  if (input.tutoring && !input.capability) return "duration";
  if (screen === "service") return null;
  if (!input.slot) return "schedule";
  if (screen === "when") return null;
  if (!input.address) return "address";
  if (!input.recipient) return "forWhom";
  if (!input.requirements) return "requirements";
  if (screen === "whereWho") return null;
  return input.payment ? null : "payment";
}

export function bookingScreenForStep(step: CustomerBookingStep, tutoring: boolean): BookingScreen {
  if (step === "service" || step === "duration") return "service";
  if (step === "schedule") return "when";
  if (step === "forWhom" && tutoring) return "service";
  if (["address", "forWhom", "requirements"].includes(step)) return "whereWho";
  return "review";
}

export function nextBookingScreen(screen: BookingScreen, editing: boolean): BookingScreen {
  return editing ? "review" : BOOKING_SCREENS[Math.min(BOOKING_SCREENS.indexOf(screen) + 1, 3)];
}

/** Different durations stay separate approved capabilities; only their presentation is grouped. */
export function groupBookingSubjects(rows: TeachingCapabilityOption[]) {
  const groups = new Map<string, TeachingCapabilityOption[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.serviceId, row.subjectCode, row.curriculumId, row.levelId]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, capabilities]) => ({ key, capabilities }));
}
