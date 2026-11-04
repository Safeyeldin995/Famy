/** Hermes does not provide Intl.PluralRules on our Android preview runtime. */
export function bookingDurationUnitKey(hours: number, language: string) {
  const plural = language.startsWith("ar")
    ? Number.isInteger(hours) && hours % 100 >= 3 && hours % 100 <= 10
    : hours !== 1;
  return plural ? "bookingDuration.hours" : "bookingDuration.hour";
}
