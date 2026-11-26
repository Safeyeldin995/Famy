import { describe, expect, it } from "vitest";
import {
  capabilityTrack,
  countdownParts,
  groupCapabilitiesByProvider,
  pickNextLesson,
  sortDirectoryTutors,
  summarizeTutorTeaching,
  tutorMatchesFilter,
  type DirectoryCapability,
} from "../onlineTutorDirectory";

function cap(partial: Partial<DirectoryCapability>): DirectoryCapability {
  return {
    providerId: "p1",
    subjectCode: "math",
    subjectNameAr: "الرياضيات",
    subjectNameEn: "Math",
    curriculumCode: "british",
    curriculumNameAr: "البريطاني",
    curriculumNameEn: "British",
    levelCode: "g4",
    levelNameAr: "الصف الرابع",
    levelNameEn: "Grade 4",
    durationMin: 60,
    price: 300,
    ...partial,
  };
}

describe("onlineTutorDirectory", () => {
  it("detects Quran and music tracks by subject code", () => {
    expect(capabilityTrack("quran_tajweed")).toBe("quran");
    expect(capabilityTrack("music_oud")).toBe("music");
    expect(capabilityTrack("math")).toBeNull();
  });

  it("summarises subjects, curricula (without 'na'), min price and durations", () => {
    const s = summarizeTutorTeaching([
      cap({}),
      cap({ subjectCode: "physics", subjectNameAr: "الفيزياء", price: 250, durationMin: 90 }),
      cap({ subjectCode: "quran_tajweed", curriculumCode: "na", price: 0 }),
    ]);
    expect(s.subjects.map((x) => x.code)).toEqual(["math", "physics", "quran_tajweed"]);
    expect(s.curricula.map((x) => x.code)).toEqual(["british"]);
    expect(s.minPrice).toBe(250);
    expect(s.durations).toEqual([60, 90]);
    expect(s.tracks).toEqual(["quran"]);
  });

  it("returns a null price when nothing is priced", () => {
    expect(summarizeTutorTeaching([cap({ price: 0 })]).minPrice).toBeNull();
  });

  it("groups capabilities per provider", () => {
    const map = groupCapabilitiesByProvider([cap({}), cap({ providerId: "p2" }), cap({})]);
    expect(map.get("p1")?.length).toBe(2);
    expect(map.get("p2")?.length).toBe(1);
  });

  it("matches curriculum and track on the same capability", () => {
    const caps = [cap({}), cap({ subjectCode: "music_oud", curriculumCode: "na" })];
    expect(tutorMatchesFilter(caps, {})).toBe(true);
    expect(tutorMatchesFilter(caps, { curriculum: "british" })).toBe(true);
    expect(tutorMatchesFilter(caps, { curriculum: "american" })).toBe(false);
    expect(tutorMatchesFilter(caps, { track: "music" })).toBe(true);
    expect(tutorMatchesFilter(caps, { track: "quran" })).toBe(false);
    expect(tutorMatchesFilter(caps, { curriculum: "british", track: "music" })).toBe(false);
  });

  it("sorts by rating with reviews and by price, unpriced last", () => {
    const list = [
      { id: "a", rating: 5, reviews: 0, minPrice: 200 },
      { id: "b", rating: 4.8, reviews: 30, minPrice: null },
      { id: "c", rating: 4.8, reviews: 40, minPrice: 150 },
    ];
    expect(sortDirectoryTutors(list, "rating").map((t) => t.id)).toEqual(["c", "b", "a"]);
    expect(sortDirectoryTutors(list, "priceLow").map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(sortDirectoryTutors(list, "recommended").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("picks the lesson in progress, else the earliest not ended", () => {
    const now = Date.parse("2026-11-26T10:00:00Z");
    const rows = [
      { id: "old", status: "confirmed", start_at: "2026-11-26T07:00:00Z", end_at: "2026-11-26T08:00:00Z" },
      { id: "later", status: "pending", start_at: "2026-11-27T10:00:00Z", end_at: "2026-11-27T11:00:00Z" },
      { id: "soon", status: "confirmed", start_at: "2026-11-26T12:00:00Z", end_at: "2026-11-26T13:00:00Z" },
      { id: "x", status: "cancelled", start_at: "2026-11-26T11:00:00Z", end_at: "2026-11-26T12:00:00Z" },
    ];
    expect(pickNextLesson(rows, now)?.id).toBe("soon");
    expect(
      pickNextLesson(
        [...rows, { id: "live", status: "in_progress", start_at: "2026-11-26T09:30:00Z", end_at: "2026-11-26T10:30:00Z" }],
        now,
      )?.id,
    ).toBe("live");
    expect(pickNextLesson([], now)).toBeNull();
  });

  it("computes a non-negative countdown", () => {
    const now = Date.parse("2026-11-26T10:00:00Z");
    expect(countdownParts(new Date("2026-11-27T12:30:00Z"), now)).toEqual({ days: 1, hours: 2, minutes: 30 });
    expect(countdownParts(new Date("2026-11-26T09:00:00Z"), now)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});
