export const PROVIDER_JOURNEY_STEPS = [
  "accepted",
  "onTheWay",
  "arrived",
  "started",
  "completed",
] as const;

export type BookingJourneySnapshot = {
  status: string;
  session_started_at?: string | null;
  arrival_confirmed_at?: string | null;
  completion_requested_at?: string | null;
  completed_at?: string | null;
};

export type StatusHistoryRow = {
  to_status: string;
  created_at: string;
};

/** Presentation only: intermediate customer confirmations keep the current milestone. */
export function journeyTimelineIndex(status: string): number {
  return (
    (
      {
        confirmed: 0,
        on_the_way: 1,
        arrived: 2,
        arrival_confirmed: 2,
        in_progress: 3,
        completion_requested: 3,
        completed: 4,
      } as Record<string, number>
    )[status] ?? -1
  );
}

/** First transition timestamp per status from history; stamps fill started/completed when present. */
export function journeyStepTimestamps(
  history: StatusHistoryRow[],
  booking: BookingJourneySnapshot,
): Record<(typeof PROVIDER_JOURNEY_STEPS)[number], string | null> {
  const firstAt = new Map<string, string>();
  for (const row of history) {
    if (!firstAt.has(row.to_status)) firstAt.set(row.to_status, row.created_at);
  }
  const started =
    booking.session_started_at ?? firstAt.get("in_progress") ?? firstAt.get("arrival_confirmed") ?? null;
  const finished =
    booking.completed_at ??
    booking.completion_requested_at ??
    firstAt.get("completed") ??
    firstAt.get("completion_requested") ??
    null;
  return {
    accepted: firstAt.get("confirmed") ?? null,
    onTheWay: firstAt.get("on_the_way") ?? null,
    arrived: firstAt.get("arrived") ?? firstAt.get("arrival_confirmed") ?? null,
    started,
    completed: finished,
  };
}
