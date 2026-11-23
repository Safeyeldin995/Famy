import { describe, expect, it } from "vitest";
import { mergeAttendanceIntervals, resolveOnlineSessionOutcome } from "@/lib/livekit/sessionOverlap";

describe("mergeAttendanceIntervals", () => {
  it("merges gaps under two minutes", () => {
    const sessionEnd = new Date("2026-11-23T15:00:00Z");
    const merged = mergeAttendanceIntervals(
      [
        { joinedAt: new Date("2026-11-23T14:00:00Z"), leftAt: new Date("2026-11-23T14:10:00Z") },
        { joinedAt: new Date("2026-11-23T14:11:00Z"), leftAt: new Date("2026-11-23T14:30:00Z") },
      ],
      2 * 60 * 1000,
      sessionEnd,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.start.toISOString()).toBe("2026-11-23T14:00:00.000Z");
    expect(merged[0]!.end.toISOString()).toBe("2026-11-23T14:30:00.000Z");
  });
});

describe("resolveOnlineSessionOutcome", () => {
  const start = new Date("2026-11-23T14:00:00Z");
  const end = new Date("2026-11-23T15:00:00Z");
  const afterGrace = new Date("2026-11-23T15:20:00Z");

  it("flags LiveKit outage when there are no events", () => {
    const r = resolveOnlineSessionOutcome({
      sessionStart: start,
      sessionEnd: end,
      now: afterGrace,
      events: [],
    });
    expect(r.code).toBe("admin_review_no_events");
    expect(r.readyToFinalize).toBe(true);
  });

  it("both absent → full refund path", () => {
    const r = resolveOnlineSessionOutcome({
      sessionStart: start,
      sessionEnd: end,
      now: afterGrace,
      events: [
        {
          participant: "customer",
          joinedAt: new Date("2026-11-23T15:20:00Z"),
          leftAt: new Date("2026-11-23T15:25:00Z"),
        },
        {
          participant: "provider",
          joinedAt: new Date("2026-11-23T15:20:00Z"),
          leftAt: new Date("2026-11-23T15:25:00Z"),
        },
      ],
    });
    expect(r.code).toBe("both_absent");
  });

  it("provider absent when only customer attended", () => {
    const r = resolveOnlineSessionOutcome({
      sessionStart: start,
      sessionEnd: end,
      now: afterGrace,
      events: [
        {
          participant: "customer",
          joinedAt: new Date("2026-11-23T14:05:00Z"),
          leftAt: new Date("2026-11-23T14:50:00Z"),
        },
      ],
    });
    expect(r.code).toBe("provider_absent");
  });

  it("customer absent applies customer no-show path", () => {
    const r = resolveOnlineSessionOutcome({
      sessionStart: start,
      sessionEnd: end,
      now: afterGrace,
      events: [
        {
          participant: "provider",
          joinedAt: new Date("2026-11-23T14:05:00Z"),
          leftAt: new Date("2026-11-23T14:50:00Z"),
        },
      ],
    });
    expect(r.code).toBe("customer_absent");
  });

  it("completes when overlap meets 50% of a one-hour session", () => {
    const r = resolveOnlineSessionOutcome({
      sessionStart: start,
      sessionEnd: end,
      now: afterGrace,
      events: [
        {
          participant: "customer",
          joinedAt: new Date("2026-11-23T14:00:00Z"),
          leftAt: new Date("2026-11-23T14:35:00Z"),
        },
        {
          participant: "provider",
          joinedAt: new Date("2026-11-23T14:00:00Z"),
          leftAt: new Date("2026-11-23T14:35:00Z"),
        },
      ],
    });
    expect(r.code).toBe("completed");
    expect(r.overlapMinutes).toBeGreaterThanOrEqual(30);
  });

  it("sends low overlap to admin review", () => {
    const r = resolveOnlineSessionOutcome({
      sessionStart: start,
      sessionEnd: end,
      now: afterGrace,
      events: [
        {
          participant: "customer",
          joinedAt: new Date("2026-11-23T14:50:00Z"),
          leftAt: new Date("2026-11-23T14:58:00Z"),
        },
        {
          participant: "provider",
          joinedAt: new Date("2026-11-23T14:50:00Z"),
          leftAt: new Date("2026-11-23T14:58:00Z"),
        },
      ],
    });
    expect(r.code).toBe("admin_review_low_overlap");
  });
});