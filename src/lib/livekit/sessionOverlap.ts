/** Pure overlap math for online session attendance (Codex audit P1). */

export type AttendanceInterval = {
  participant: "customer" | "provider";
  joinedAt: Date;
  leftAt: Date | null;
};

export type OverlapSettings = {
  /** Gaps shorter than this between intervals are merged (default 2 min). */
  disconnectIgnoreMs: number;
  /** Fraction of session duration required to complete (0–1). */
  overlapFraction: number;
};

const DEFAULT_SETTINGS: OverlapSettings = {
  disconnectIgnoreMs: 2 * 60 * 1000,
  overlapFraction: 0.5,
};

export function mergeAttendanceIntervals(
  intervals: { joinedAt: Date; leftAt: Date | null }[],
  ignoreGapMs: number,
  sessionEnd: Date,
): { start: Date; end: Date }[] {
  const closed = intervals
    .map((i) => ({
      start: i.joinedAt,
      end: i.leftAt && i.leftAt > i.joinedAt ? i.leftAt : sessionEnd,
    }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (closed.length === 0) return [];

  const merged: { start: Date; end: Date }[] = [closed[0]!];
  for (let idx = 1; idx < closed.length; idx++) {
    const cur = closed[idx]!;
    const prev = merged[merged.length - 1]!;
    if (cur.start.getTime() - prev.end.getTime() <= ignoreGapMs) {
      if (cur.end > prev.end) prev.end = cur.end;
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

export function overlapMs(
  a: { start: Date; end: Date }[],
  b: { start: Date; end: Date }[],
): number {
  let total = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i]!.start.getTime(), b[j]!.start.getTime());
    const end = Math.min(a[i]!.end.getTime(), b[j]!.end.getTime());
    if (end > start) total += end - start;
    if (a[i]!.end <= b[j]!.end) i++;
    else j++;
  }
  return total;
}

export function participantMinutes(
  merged: { start: Date; end: Date }[],
): number {
  const ms = merged.reduce((sum, row) => sum + (row.end.getTime() - row.start.getTime()), 0);
  return Math.round(ms / 60_000);
}

export type OnlineSessionOutcomeCode =
  | "pending"
  | "completed"
  | "provider_absent"
  | "customer_absent"
  | "both_absent"
  | "admin_review_low_overlap"
  | "admin_review_no_events"
  | "admin_review_reported";

export function resolveOnlineSessionOutcome(input: {
  sessionStart: Date;
  sessionEnd: Date;
  now: Date;
  events: AttendanceInterval[];
  settings?: Partial<OverlapSettings>;
}): {
  code: OnlineSessionOutcomeCode;
  overlapMinutes: number;
  requiredOverlapMinutes: number;
  customerMinutes: number;
  providerMinutes: number;
  readyToFinalize: boolean;
} {
  const settings = { ...DEFAULT_SETTINGS, ...input.settings };
  const graceEnd = new Date(input.sessionEnd.getTime() + 15 * 60 * 1000);
  const readyToFinalize = input.now >= graceEnd;

  const durationMs = input.sessionEnd.getTime() - input.sessionStart.getTime();
  const requiredOverlapMinutes = Math.max(
    1,
    Math.ceil((durationMs / 60_000) * settings.overlapFraction),
  );

  const clipped = (participant: "customer" | "provider") =>
    input.events
      .filter((e) => e.participant === participant)
      .map((e) => {
        let joinedAt = e.joinedAt < input.sessionStart ? input.sessionStart : e.joinedAt;
        if (joinedAt >= input.sessionEnd) {
          return { joinedAt: input.sessionStart, leftAt: input.sessionStart };
        }
        let end = e.leftAt && e.leftAt > joinedAt ? e.leftAt : input.sessionEnd;
        if (end > input.sessionEnd) end = input.sessionEnd;
        return { joinedAt, leftAt: end };
      })
      .filter((row) => row.leftAt > row.joinedAt);

  const customerMerged = mergeAttendanceIntervals(
    clipped("customer"),
    settings.disconnectIgnoreMs,
    input.sessionEnd,
  );
  const providerMerged = mergeAttendanceIntervals(
    clipped("provider"),
    settings.disconnectIgnoreMs,
    input.sessionEnd,
  );

  const overlapMinutes = Math.round(
    overlapMs(customerMerged, providerMerged) / 60_000,
  );
  const customerMinutes = participantMinutes(customerMerged);
  const providerMinutes = participantMinutes(providerMerged);

  if (input.events.length === 0) {
    return {
      code: "admin_review_no_events",
      overlapMinutes: 0,
      requiredOverlapMinutes,
      customerMinutes,
      providerMinutes,
      readyToFinalize,
    };
  }

  if (customerMinutes === 0 && providerMinutes === 0) {
    return {
      code: "both_absent",
      overlapMinutes: 0,
      requiredOverlapMinutes,
      customerMinutes,
      providerMinutes,
      readyToFinalize,
    };
  }

  if (providerMinutes === 0) {
    return {
      code: "provider_absent",
      overlapMinutes: 0,
      requiredOverlapMinutes,
      customerMinutes,
      providerMinutes,
      readyToFinalize,
    };
  }

  if (customerMinutes === 0) {
    return {
      code: "customer_absent",
      overlapMinutes: 0,
      requiredOverlapMinutes,
      customerMinutes,
      providerMinutes,
      readyToFinalize,
    };
  }

  if (overlapMinutes >= requiredOverlapMinutes) {
    return {
      code: "completed",
      overlapMinutes,
      requiredOverlapMinutes,
      customerMinutes,
      providerMinutes,
      readyToFinalize,
    };
  }

  return {
    code: "admin_review_low_overlap",
    overlapMinutes,
    requiredOverlapMinutes,
    customerMinutes,
    providerMinutes,
    readyToFinalize,
  };
}