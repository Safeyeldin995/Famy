import type { CustomerBookingStep } from "./customerSteps";

export const ONLINE_LESSON_BOOK_STEPS = 2;

export function isOnlineWhenStep(step: number, isOnline: boolean): boolean {
  return isOnline ? step === 0 : step === 1;
}

export function isOnlineRequestStep(step: number, isOnline: boolean): boolean {
  return isOnline ? step === 1 : step === 3;
}

export function onlineLessonBookMissing(input: {
  service: boolean;
  slot: boolean;
  tutoring: boolean;
  capability: boolean;
  recipient: boolean;
}): CustomerBookingStep | null {
  if (!input.service) return "service";
  if (!input.slot) return "schedule";
  if (input.tutoring && !input.capability) return "duration";
  if (!input.recipient) return "forWhom";
  return null;
}