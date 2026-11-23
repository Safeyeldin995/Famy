import { describe, expect, it } from "vitest";
import {
  mergePresenceIntervals,
  resolveOnlineSessionOutcome,
  type SessionEventRow,
} from "@/lib/livekit/sessionAttendance";

const start = Date.parse("2026-11-23T14:00:00.000Z");
const end = Date.parse("2026-11-23T15:00:00.000Z");

function ev(
  participant: "customer" | "provider",
  joined: string,
  left: string | null,
): SessionEventRow {
  return { participant, joined_at: joined, left_at: left };
}

describe("mergePresenceIntervals", () => {
  it("merges gaps under 2 minutes", () => {
    const merged = mergePresenceIntervals(
      [
        { startMs: 0, endMs: 60_000 },
        { startMs: 90_000, endMs: 120_000 },
      ],
      120_000,
    );
    expect(merged).toEqual([{ startMs: 0, endMs: 120_000 }]);
  });

  it("keeps gaps at or above 2 minutes separate", () => {
    const merged = mergePresenceIntervals(
      [
        { startMs: 0, endMs: 60_000 },
        { startMs: 181_000, endMs: 240_000 },
      ],
      120_000,
    );
    expect(merged).toHaveLength(2);
  });
});

describe("resolveOnlineSessionOutcome", () => {
  const base = {
    startAtMs: start,
    endAtMs: end,
    nowMs: end + 60_000,
    overlapRatioRequired: 0.5,
    disconnectIgnoreMs: 120_000,
  };

  it("provider absent → provider_absent", () => {
    const result = resolveOnlineSessionOutcome({
      ...base,
      events: [ev("customer", "2026-11-23T14:00:00.000Z", "2026-11-23T15:00:00.000Z")],
    });
    expect(result.outcome).toBe("provider_absent");
  });

  it("customer absent → customer_absent", () => {
    const result = resolveOnlineSessionOutcome({
      ...base,
      events: [ev("provider", "2026-11-23T14:00:00.000Z", "2026-11-23T15:00:00.000Z")],
    });
    expect(result.outcome).toBe("customer_absent");
  });

  it("no events at all → admin_review_no_events", () => {
    const result = resolveOnlineSessionOutcome({ ...base, events: [] });
    expect(result.outcome).toBe("admin_review_no_events");
  });

  it("both absent with orphan events that do not overlap → both_absent", () => {
    const result = resolveOnlineSessionOutcome({
      ...base,
      events: [
        ev("customer", "2026-11-23T14:00:00.000Z", "2026-11-23T14:01:00.000Z"),
        ev("provider", "2026-11-23T14:59:00.000Z", "2026-11-23T15:00:00.000Z"),
      ],
    });
    expect(result.outcome).toBe("admin_review_overlap");
  });

  it("completes when overlap meets 50% of duration", () => {
    const result = resolveOnlineSessionOutcome({
      ...base,
      events: [
        ev("customer", "2026-11-23T14:00:00.000Z", "2026-11-23T15:00:00.000Z"),
        ev("provider", "2026-11-23T14:00:00.000Z", "2026-11-23T15:00:00.000Z"),
      ],
    });
    expect(result.outcome).toBe("complete");
    expect(result.overlapMinutes).toBe(60);
  });

  it("late join below threshold → admin_review_overlap", () => {
    const result = resolveOnlineSessionOutcome({
      ...base,
      events: [
        ev("customer", "2026-11-23T14:00:00.000Z", "2026-11-23T15:00:00.000Z"),
        ev("provider", "2026-11-23T14:45:00.000Z", "2026-11-23T15:00:00.000Z"),
      ],
    });
    expect(result.outcome).toBe("admin_review_overlap");
    expect(result.overlapMinutes).toBe(15);
  });

  it("both absent when neither side has presence intervals", () => {
    const result = resolveOnlineSessionOutcome({
      ...base,
      events: [
        ev("customer", "2026-11-23T14:00:00.000Z", "2026-11-23T14:00:00.000Z"),
        ev("provider", "2026-11-23T14:00:00.000Z", "2026-11-23T14:00:00.000Z"),
      ],
    });
    expect(result.outcome).toBe("both_absent");
  });
});