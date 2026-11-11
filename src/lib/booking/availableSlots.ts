/**
 * Client slot-picker lead time must match `check_booking_slot`, which only
 * enforces the provider's `min_notice_hours` — not pending-booking expiry.
 */
export function earliestBookableInstant(now: Date, providerMinNoticeHours: number): Date {
  const hours = Math.max(0, providerMinNoticeHours);
  return new Date(now.getTime() + hours * 3_600_000);
}

export function isSlotStartBookable(
  slotStart: Date,
  earliestAllowed: Date,
  latestAllowed: Date,
): boolean {
  return slotStart >= earliestAllowed && slotStart <= latestAllowed;
}
