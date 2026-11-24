import { describe, expect, it } from "vitest";
import { onlineLessonJourneyIndex } from "../onlineLessonJourney";
import {
  onlineLessonPaymentDeadline,
  onlineLessonPaymentDeadlineMs,
} from "../onlineLessonPaymentDeadline";

describe("onlineLessonPaymentDeadline", () => {
  it("uses the earlier of confirm+2h and start-1h", () => {
    const confirmed = "2026-11-23T10:00:00.000Z";
    const start = "2026-11-23T14:00:00.000Z";
    const deadline = onlineLessonPaymentDeadline(confirmed, start);
    expect(deadline.toISOString()).toBe("2026-11-23T12:00:00.000Z");
  });

  it("returns remaining ms until deadline", () => {
    const confirmed = "2026-11-23T10:00:00.000Z";
    const start = "2026-11-23T14:00:00.000Z";
    const ms = onlineLessonPaymentDeadlineMs(confirmed, start, undefined);
    expect(ms).not.toBeNull();
    expect(ms).toBeGreaterThanOrEqual(0);
  });
});

describe("onlineLessonJourneyIndex", () => {
  const start = "2030-06-01T14:00:00.000Z";
  const end = "2030-06-01T15:00:00.000Z";
  const now = new Date("2030-05-01T10:00:00.000Z").getTime();

  it("maps pending → requested", () => {
    expect(onlineLessonJourneyIndex("pending", false, now, start, end)).toBe(0);
  });

  it("maps confirmed unpaid → pay step", () => {
    expect(onlineLessonJourneyIndex("confirmed", false, now, start, end)).toBe(1);
  });

  it("maps paid before start window", () => {
    expect(
      onlineLessonJourneyIndex("accepted", true, new Date("2026-11-23T10:00:00Z").getTime(), start, end),
    ).toBe(2);
  });
});