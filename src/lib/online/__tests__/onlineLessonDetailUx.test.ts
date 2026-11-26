import { describe, expect, it } from "vitest";
import { onlineLessonDetailGuidance } from "../onlineLessonDetailUx";

describe("onlineLessonDetailGuidance", () => {
  it("shows pay-by deadline for confirmed unpaid lessons", () => {
    const startAt = new Date("2030-06-01T14:00:00.000Z");
    const endAt = new Date("2030-06-01T15:00:00.000Z");
    const guidance = onlineLessonDetailGuidance({
      status: "confirmed",
      paymentCaptured: false,
      paidHeld: false,
      confirmedAt: "2030-06-01T10:00:00.000Z",
      startAt,
      endAt,
      now: new Date("2030-05-01T10:00:00.000Z").getTime(),
      locale: "en-GB",
    });
    expect(guidance?.messageKey).toBe("onlineWeb.lessonDetail.payBy");
    expect(guidance?.messageParams?.time).toBeTruthy();
  });

  it("shows done guidance for completed paid lessons", () => {
    const startAt = new Date("2030-06-01T14:00:00.000Z");
    const endAt = new Date("2030-06-01T15:00:00.000Z");
    const guidance = onlineLessonDetailGuidance({
      status: "completed",
      paymentCaptured: true,
      paidHeld: false,
      confirmedAt: "2030-06-01T10:00:00.000Z",
      startAt,
      endAt,
      now: new Date("2030-06-02T10:00:00.000Z").getTime(),
      locale: "en-GB",
    });
    expect(guidance?.messageKey).toBe("onlineLesson.journey.next.done");
    expect(guidance?.showJoinDisabled).toBeUndefined();
  });

  it("does not show join-from after a paid lesson ends", () => {
    const startAt = new Date("2030-06-01T14:00:00.000Z");
    const endAt = new Date("2030-06-01T15:00:00.000Z");
    const guidance = onlineLessonDetailGuidance({
      status: "confirmed",
      paymentCaptured: true,
      paidHeld: false,
      confirmedAt: "2030-06-01T10:00:00.000Z",
      startAt,
      endAt,
      now: new Date("2030-06-01T16:00:00.000Z").getTime(),
      locale: "en-GB",
    });
    expect(guidance?.messageKey).not.toBe("onlineWeb.lessonDetail.joinFrom");
    expect(guidance?.showJoinDisabled).toBeUndefined();
  });
});