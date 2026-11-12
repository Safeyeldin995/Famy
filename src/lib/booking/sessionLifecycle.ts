/** Mirrors DB rule: COALESCE(session_started_at, arrival_confirmed_at, start_at) + (end_at - start_at). */
export function sessionDurationEndsAt(booking: {
  start_at: string;
  end_at: string;
  session_started_at?: string | null;
  arrival_confirmed_at?: string | null;
}): Date {
  const startMs = new Date(booking.start_at).getTime();
  const endMs = new Date(booking.end_at).getTime();
  const durationMs = endMs - startMs;
  const sessionStartMs = new Date(
    booking.session_started_at ?? booking.arrival_confirmed_at ?? booking.start_at,
  ).getTime();
  return new Date(sessionStartMs + durationMs);
}

export function minutesUntilSessionCompletionAllowed(endsAt: Date, now = new Date()): number {
  const diffMs = endsAt.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.max(1, Math.ceil(diffMs / 60_000));
}

export function isSessionCompletionAllowed(
  booking: Parameters<typeof sessionDurationEndsAt>[0],
  now = new Date(),
): boolean {
  return now.getTime() >= sessionDurationEndsAt(booking).getTime();
}
