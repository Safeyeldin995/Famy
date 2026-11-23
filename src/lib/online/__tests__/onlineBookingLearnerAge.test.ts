import { describe, expect, it } from "vitest";
import { onlineBookingLearnerAgeIssue } from "@/lib/online/onlineBookingLearnerAge";

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