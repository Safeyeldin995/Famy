export type SessionEventRow = {
  participant: "customer" | "provider";
  joined_at: string;
  left_at: string | null;
};

export type PresenceInterval = { startMs: number; endMs: number };

export const DEFAULT_DISCONNECT_IGNORE_MS = 2 * 60 * 1000;
export const DEFAULT_OVERLAP_RATIO = 0.5;

export type OnlineSessionOutcome =
  | "complete"
  | "provider_absent"
  | "customer_absent"
  | "both_absent"
  | "admin_review_overlap"
  | "admin_review_no_events"
  | "pending";

export function intervalsForParticipant(
  events: SessionEventRow[],
  participant: "customer" | "provider",
  sessionEndMs: number,
  nowMs: number,
): PresenceInterval[] {
  const endCap = Math.min(nowMs, sessionEndMs);
  const raw: PresenceInterval[] = [];
  for (const row of events) {
    if (row.participant !== participant) continue;
    const startMs = Date.parse(row.joined_at);
    if (Number.isNaN(startMs)) continue;
    const leftMs = row.left_at ? Date.parse(row.left_at) : endCap;
    const endMs = Number.isNaN(leftMs) ? endCap : Math.min(leftMs, endCap);
    if (endMs <= startMs) continue;
    raw.push({ startMs, endMs });
  }
  raw.sort((a, b) => a.startMs - b.startMs);
  return raw;
}

export function mergePresenceIntervals(
  intervals: PresenceInterval[],
  gapIgnoreMs: number,
): PresenceInterval[] {
  if (intervals.length === 0) return [];
  const merged: PresenceInterval[] = [{ ...intervals[0] }];
  for (let i = 1; i < intervals.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = intervals[i];
    if (cur.startMs - prev.endMs <= gapIgnoreMs) {
      prev.endMs = Math.max(prev.endMs, cur.endMs);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

export function overlapMinutes(
  a: PresenceInterval[],
  b: PresenceInterval[],
): number {
  let totalMs = 0;
  for (const left of a) {
    for (const right of b) {
      const start = Math.max(left.startMs, right.startMs);
      const end = Math.min(left.endMs, right.endMs);
      if (end > start) totalMs += end - start;
    }
  }
  return totalMs / 60_000;
}

export function participantWasPresent(intervals: PresenceInterval[]): boolean {
  return intervals.some((i) => i.endMs > i.startMs);
}

export function resolveOnlineSessionOutcome(input: {
  events: SessionEventRow[];
  startAtMs: number;
  endAtMs: number;
  nowMs: number;
  overlapRatioRequired?: number;
  disconnectIgnoreMs?: number;
}): {
  outcome: OnlineSessionOutcome;
  overlapMinutes: number;
  durationMinutes: number;
  customerPresent: boolean;
  providerPresent: boolean;
} {
  const overlapRatioRequired = input.overlapRatioRequired ?? DEFAULT_OVERLAP_RATIO;
  const disconnectIgnoreMs = input.disconnectIgnoreMs ?? DEFAULT_DISCONNECT_IGNORE_MS;
  const durationMinutes = Math.max(0, (input.endAtMs - input.startAtMs) / 60_000);
  const requiredOverlap = durationMinutes * overlapRatioRequired;

  if (input.events.length === 0) {
    return {
      outcome: "admin_review_no_events",
      overlapMinutes: 0,
      durationMinutes,
      customerPresent: false,
      providerPresent: false,
    };
  }

  const customerRaw = mergePresenceIntervals(
    intervalsForParticipant(input.events, "customer", input.endAtMs, input.nowMs),
    disconnectIgnoreMs,
  );
  const providerRaw = mergePresenceIntervals(
    intervalsForParticipant(input.events, "provider", input.endAtMs, input.nowMs),
    disconnectIgnoreMs,
  );

  const customerPresent = participantWasPresent(customerRaw);
  const providerPresent = participantWasPresent(providerRaw);
  const overlap = overlapMinutes(customerRaw, providerRaw);

  if (!customerPresent && !providerPresent) {
    return {
      outcome: "both_absent",
      overlapMinutes: overlap,
      durationMinutes,
      customerPresent,
      providerPresent,
    };
  }
  if (!providerPresent) {
    return {
      outcome: "provider_absent",
      overlapMinutes: overlap,
      durationMinutes,
      customerPresent,
      providerPresent,
    };
  }
  if (!customerPresent) {
    return {
      outcome: "customer_absent",
      overlapMinutes: overlap,
      durationMinutes,
      customerPresent,
      providerPresent,
    };
  }

  if (input.nowMs < input.endAtMs) {
    return {
      outcome: "pending",
      overlapMinutes: overlap,
      durationMinutes,
      customerPresent,
      providerPresent,
    };
  }

  if (overlap < requiredOverlap) {
    return {
      outcome: "admin_review_overlap",
      overlapMinutes: overlap,
      durationMinutes,
      customerPresent,
      providerPresent,
    };
  }

  return {
    outcome: "complete",
    overlapMinutes: overlap,
    durationMinutes,
    customerPresent,
    providerPresent,
  };
}