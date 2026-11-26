import { describe, expect, it } from "vitest";
import { onlineLessonBookMissing } from "../onlineLessonBookSteps";
import { onlineBookingLearnerAgeIssue } from "@/lib/online/onlineBookingLearnerAge";

describe("onlineLessonBookMissing", () => {
  it("blocks online booking when recipient is not ready", () => {
    expect(
      onlineLessonBookMissing({
        service: true,
        slot: true,
        tutoring: true,
        capability: true,
        recipient: false,
      }),
    ).toBe("forWhom");
  });
});

describe("onlineBookingLearnerAgeIssue", () => {
  it("requires birth date for myself without a saved profile dob", () => {
    expect(onlineBookingLearnerAgeIssue("myself", null, [])).toBe("birth_date_required");
  });
});