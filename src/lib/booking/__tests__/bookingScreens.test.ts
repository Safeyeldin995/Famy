import { describe, expect, it } from "vitest";
import {
  BOOKING_SCREENS,
  bookingScreenMissingStep,
  bookingScreenForStep,
  nextBookingScreen,
  groupBookingSubjects,
} from "../bookingScreens";
import { bookingPreviewCapability } from "@/lib/preview/customerBookingPreview";

const ready = {
  service: true,
  tutoring: false,
  capability: false,
  slot: true,
  address: true,
  recipient: true,
  requirements: true,
  payment: true,
};

describe("four booking screens", () => {
  it("has exactly four screens and returns review edits to review", () => {
    expect(BOOKING_SCREENS).toEqual(["service", "when", "whereWho", "review"]);
    expect(BOOKING_SCREENS.map((screen) => nextBookingScreen(screen, false))).toEqual([
      "when",
      "whereWho",
      "review",
      "review",
    ]);
    for (const screen of BOOKING_SCREENS) expect(nextBookingScreen(screen, true)).toBe("review");
  });
  it("preserves recipient, requirement and payment gates in the combined screens", () => {
    expect(bookingScreenMissingStep("whereWho", { ...ready, recipient: false })).toBe("forWhom");
    expect(bookingScreenMissingStep("whereWho", { ...ready, requirements: false })).toBe(
      "requirements",
    );
    expect(bookingScreenMissingStep("review", { ...ready, requirements: false })).toBe(
      "requirements",
    );
    expect(bookingScreenMissingStep("review", { ...ready, payment: false })).toBe("payment");
    expect(bookingScreenMissingStep("review", { ...ready, slot: false })).toBe("schedule");
    expect(
      bookingScreenMissingStep("service", { ...ready, recipient: false, requirements: false }),
    ).toBeNull();
  });
  it("requires the tutoring recipient before the capability, on screen one", () => {
    expect(
      bookingScreenMissingStep("service", { ...ready, tutoring: true, recipient: false }),
    ).toBe("forWhom");
    expect(bookingScreenMissingStep("service", { ...ready, tutoring: true })).toBe("duration");
    expect(
      bookingScreenMissingStep("service", { ...ready, tutoring: true, capability: true }),
    ).toBeNull();
    expect(bookingScreenForStep("forWhom", true)).toBe("service");
    expect(bookingScreenForStep("forWhom", false)).toBe("whereWho");
    expect(bookingScreenForStep("requirements", false)).toBe("whereWho");
    expect(bookingScreenForStep("schedule", false)).toBe("when");
  });
  it("groups durations without merging subjects or levels, preserving capability IDs/prices", () => {
    const rows = [
      bookingPreviewCapability,
      { ...bookingPreviewCapability, id: "90", durationMin: 90, price: 600 },
      { ...bookingPreviewCapability, id: "level-2", levelId: "grade-2" },
      { ...bookingPreviewCapability, id: "subject-2", subjectCode: "science" },
    ];
    expect(groupBookingSubjects(rows).map((group) => group.capabilities)).toEqual([
      rows.slice(0, 2),
      [rows[2]],
      [rows[3]],
    ]);
  });
});
