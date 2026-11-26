import { describe, expect, it } from "vitest";
import {
  ONLINE_PARENT_SUPERVISION_MODE,
  onlineBookingLearnerAgeIssue,
  onlineBookingSupervisionMode,
  onlineLearnerReady,
} from "@/lib/online/onlineBookingLearnerAge";

describe("onlineBookingLearnerAgeIssue", () => {
  it("requires profile date of birth when booking for myself", () => {
    expect(onlineBookingLearnerAgeIssue("myself", null, [])).toBe("birth_date_required");
  });

  it("blocks learners under 12", () => {
    expect(
      onlineBookingLearnerAgeIssue("myself", "2018-06-01", []),
    ).toBe("age_minimum");
  });

  it("allows learners 12 and older", () => {
    expect(
      onlineBookingLearnerAgeIssue("myself", "2010-06-01", []),
    ).toBeNull();
  });
});
describe("online lessons for a child under 12 booked by the parent", () => {
  const child = { id: "child-1", date_of_birth: "2019-03-01" };
  const teen = { id: "teen-1", date_of_birth: "2010-03-01" };

  it("asks the parent to confirm supervision instead of blocking", () => {
    expect(onlineBookingLearnerAgeIssue("child-1", null, [child])).toBe(
      "parent_supervision_required",
    );
  });

  it("does not need supervision for a child 12 or older", () => {
    expect(onlineBookingLearnerAgeIssue("teen-1", null, [teen])).toBeNull();
  });

  it("is ready only after the parent confirms", () => {
    expect(onlineLearnerReady("parent_supervision_required", false)).toBe(false);
    expect(onlineLearnerReady("parent_supervision_required", true)).toBe(true);
    expect(onlineLearnerReady("age_minimum", true)).toBe(false);
    expect(onlineLearnerReady(null, false)).toBe(true);
  });

  it("sends parent_online only for a confirmed child under 12", () => {
    expect(onlineBookingSupervisionMode("parent_supervision_required", true)).toBe(
      ONLINE_PARENT_SUPERVISION_MODE,
    );
    expect(onlineBookingSupervisionMode("parent_supervision_required", false)).toBeNull();
    expect(onlineBookingSupervisionMode(null, true)).toBeNull();
    expect(onlineBookingSupervisionMode("age_minimum", true)).toBeNull();
  });
});
