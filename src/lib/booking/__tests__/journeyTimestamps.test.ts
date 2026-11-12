import { describe, expect, it } from "vitest";
import { journeyStepTimestamps } from "../journeyTimestamps";

describe("journeyStepTimestamps", () => {
  it("uses earliest history row per target status", () => {
    const times = journeyStepTimestamps(
      [
        { to_status: "confirmed", created_at: "2026-01-01T10:00:00Z" },
        { to_status: "on_the_way", created_at: "2026-01-01T11:00:00Z" },
        { to_status: "on_the_way", created_at: "2026-01-01T11:05:00Z" },
        { to_status: "arrived", created_at: "2026-01-01T11:30:00Z" },
        { to_status: "in_progress", created_at: "2026-01-01T11:40:00Z" },
        { to_status: "completed", created_at: "2026-01-01T12:40:00Z" },
      ],
      { status: "completed" },
    );
    expect(times.accepted).toBe("2026-01-01T10:00:00Z");
    expect(times.onTheWay).toBe("2026-01-01T11:00:00Z");
    expect(times.arrived).toBe("2026-01-01T11:30:00Z");
    expect(times.started).toBe("2026-01-01T11:40:00Z");
    expect(times.completed).toBe("2026-01-01T12:40:00Z");
  });

  it("prefers session and completion stamps on the booking row", () => {
    const times = journeyStepTimestamps([], {
      status: "completion_requested",
      session_started_at: "2026-02-01T09:00:00Z",
      completion_requested_at: "2026-02-01T10:00:00Z",
    });
    expect(times.started).toBe("2026-02-01T09:00:00Z");
    expect(times.completed).toBe("2026-02-01T10:00:00Z");
  });
});
