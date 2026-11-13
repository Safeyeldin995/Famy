import type { BookingScreen } from "./bookingScreens";

/** Primary footer labels for the four customer booking screens (final step keeps confirm). */
export function bookingScreenPrimaryCtaKey(
  screen: BookingScreen,
  reviewing: boolean,
): string {
  if (screen === "review") return "customerBooking.confirm";
  if (reviewing) return "customerBooking.next";
  const keys: Record<Exclude<BookingScreen, "review">, string> = {
    service: "bookFlow.ctaPickWhen",
    when: "bookFlow.ctaConfirmVisit",
    whereWho: "bookFlow.ctaReviewPay",
  };
  return keys[screen];
}
