/**
 * When the customer booking screen re-fetches the booking on its own. Pure so it
 * can be tested; the hook supplies focus, elapsed polling time and error count.
 */
export const BOOKING_POLL_MS = 20_000;
/** Stop after this long of continuous polling (push notifications still update). */
export const BOOKING_POLL_MAX_MS = 15 * 60_000;
/** Stop after this many failed refreshes in a row. */
export const BOOKING_POLL_MAX_ERRORS = 3;
/** A confirmed booking is polled only when it starts within this window. */
export const CONFIRMED_POLL_WINDOW_MS = 2 * 60 * 60_000;

const MOVING_STATUSES = new Set(["pending", "on_the_way", "arrived"]);

export function bookingPollInterval(input: {
  status: string | null | undefined;
  startAt: string | null | undefined;
  focused: boolean;
  pollingSinceMs: number | null;
  nowMs: number;
  consecutiveErrors: number;
}): number | false {
  if (!input.focused) return false;
  if (input.consecutiveErrors >= BOOKING_POLL_MAX_ERRORS) return false;
  if (input.pollingSinceMs != null && input.nowMs - input.pollingSinceMs >= BOOKING_POLL_MAX_MS) {
    return false;
  }
  const status = input.status ?? "";
  if (MOVING_STATUSES.has(status)) return BOOKING_POLL_MS;
  if (status === "confirmed" && input.startAt) {
    const start = Date.parse(input.startAt);
    if (Number.isFinite(start) && start - input.nowMs <= CONFIRMED_POLL_WINDOW_MS) {
      return BOOKING_POLL_MS;
    }
  }
  return false;
}
