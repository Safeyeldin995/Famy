import { describe, expect, it } from "vitest";
import {
  emptyDraft,
  formatQuranRange,
  instrumentFromSubject,
  isValidRange,
  juzRange,
  lessonReportErrorKey,
  percent,
  quranKindFromSubject,
  surahStatus,
  validateDraft,
  type JuzStart,
  type Surah,
} from "../lessonReports";

const SURAHS: Surah[] = [
  { number: 1, name_ar: "الفاتحة", name_en: "Al-Fatihah", ayah_count: 7 },
  { number: 2, name_ar: "البقرة", name_en: "Al-Baqarah", ayah_count: 286 },
  { number: 3, name_ar: "آل عمران", name_en: "Al Imran", ayah_count: 200 },
];
const JUZ: JuzStart[] = [
  { juz: 1, start_surah: 1, start_ayah: 1 },
  { juz: 2, start_surah: 2, start_ayah: 142 },
  { juz: 3, start_surah: 2, start_ayah: 253 },
  { juz: 4, start_surah: 3, start_ayah: 93 },
];

describe("lesson report helpers", () => {
  it("derives the instrument and Quran kind from the lesson subject", () => {
    expect(instrumentFromSubject("music_piano_keyboard")).toBe("piano_keyboard");
    expect(instrumentFromSubject("music_drums")).toBeNull();
    expect(instrumentFromSubject("english")).toBeNull();
    expect(quranKindFromSubject("quran_tajweed")).toBe("tajweed");
    expect(quranKindFromSubject("quran_recitation_review")).toBe("review");
    expect(quranKindFromSubject("quran_memorization")).toBe("new");
  });

  it("validates ranges against the surah catalog", () => {
    expect(isValidRange({ from_surah: 1, from_ayah: 1, to_surah: 1, to_ayah: 7 }, SURAHS)).toBe(
      true,
    );
    expect(isValidRange({ from_surah: 1, from_ayah: 1, to_surah: 1, to_ayah: 8 }, SURAHS)).toBe(
      false,
    );
    expect(isValidRange({ from_surah: 2, from_ayah: 5, to_surah: 2, to_ayah: 4 }, SURAHS)).toBe(
      false,
    );
    expect(isValidRange({ from_surah: 1, from_ayah: 7, to_surah: 2, to_ayah: 1 }, SURAHS)).toBe(
      true,
    );
    expect(isValidRange({ from_surah: 9, from_ayah: 1, to_surah: 9, to_ayah: 1 }, SURAHS)).toBe(
      false,
    );
  });

  it("turns a juz into a range, including one that ends mid-surah", () => {
    expect(juzRange(1, JUZ, SURAHS)).toEqual({
      from_surah: 1,
      from_ayah: 1,
      to_surah: 2,
      to_ayah: 141,
    });
    expect(juzRange(3, JUZ, SURAHS)).toEqual({
      from_surah: 2,
      from_ayah: 253,
      to_surah: 3,
      to_ayah: 92,
    });
    expect(juzRange(4, JUZ, SURAHS)).toEqual({
      from_surah: 3,
      from_ayah: 93,
      to_surah: 3,
      to_ayah: 200,
    });
  });

  it("checks a draft with the same rules as the server", () => {
    const quran = emptyDraft("quran", "quran_memorization");
    expect(validateDraft("quran", quran, SURAHS)).toEqual(["covered", "understanding"]);
    const filled = { ...quran, covered: "حفظ الفاتحة", understanding: "good" as const };
    expect(validateDraft("quran", filled, SURAHS)).toEqual([]);
    expect(validateDraft("quran", { ...filled, quran: [] }, SURAHS)).toEqual(["quranRequired"]);
    const music = {
      ...emptyDraft("music", "music_oud"),
      covered: "سلم",
      understanding: "good" as const,
    };
    expect(music.musicInstrument).toBe("oud");
    expect(validateDraft("music", music, SURAHS)).toEqual(["musicLevel"]);
  });

  it("formats ranges and progress", () => {
    const fmt = formatQuranRange(
      { kind: "new", from_surah: 1, from_ayah: 1, to_surah: 2, to_ayah: 5 },
      "ar",
      SURAHS,
    );
    expect(fmt).toBe("الفاتحة 1 – البقرة 5");
    expect(
      formatQuranRange(
        { kind: "new", from_surah: 2, from_ayah: 1, to_surah: 2, to_ayah: 5 },
        "en",
        SURAHS,
      ),
    ).toBe("Al-Baqarah 1–5");
    expect(percent(1, 6236)).toBe(1);
    expect(percent(0, 6236)).toBe(0);
    expect(percent(564, 564)).toBe(100);
    const base = { number: 1, name_ar: "", name_en: "", ayah_count: 7, reviewed_ayahs: 0 };
    expect(surahStatus({ ...base, memorized_ayahs: 7 })).toBe("memorized");
    expect(surahStatus({ ...base, memorized_ayahs: 3 })).toBe("in_progress");
    expect(surahStatus({ ...base, memorized_ayahs: 0, reviewed_ayahs: 7 })).toBe("reviewed");
  });

  it("maps server errors to translation keys", () => {
    expect(lessonReportErrorKey({ message: "LESSON_REPORT_QURAN_RANGE_INVALID" })).toBe(
      "lessonReport.errors.LESSON_REPORT_QURAN_RANGE_INVALID",
    );
    expect(lessonReportErrorKey(new Error("boom"))).toBe("lessonReport.errors.generic");
  });
});
