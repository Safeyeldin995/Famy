import { describe, expect, it } from "vitest";
import {
  lessonIllustrationKeyForService,
  lessonIllustrationKeyForSubject,
} from "../lessonIllustrations";

describe("lessonIllustrations", () => {
  it("maps lesson subjects and service tiles", () => {
    expect(lessonIllustrationKeyForSubject("quran_tajweed")).toBe("quran_tajweed");
    expect(lessonIllustrationKeyForSubject("music_violin")).toBe("music_violin");
    expect(lessonIllustrationKeyForSubject("math")).toBeNull();
    expect(lessonIllustrationKeyForService("quran-lessons")).toBe("quran_lessons_tile");
    expect(lessonIllustrationKeyForService("music-lessons")).toBe("music_lessons_tile");
    expect(lessonIllustrationKeyForService("school-subject-tutoring")).toBeNull();
  });
});
