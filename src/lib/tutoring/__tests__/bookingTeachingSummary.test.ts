import { describe, expect, it } from "vitest";
import { bookingTeachingSummary } from "../bookingTeachingSummary";

describe("bookingTeachingSummary", () => {
  it("shows subject, curriculum and level for school tutoring", () => {
    expect(
      bookingTeachingSummary(
        {
          teaching_subject_code: "math",
          teaching_subject_name_ar: "الرياضيات",
          teaching_curriculum_code: "national",
          teaching_curriculum_name_ar: "عربي",
          teaching_level_name_ar: "الصف الرابع",
        },
        "ar",
      ),
    ).toBe("الرياضيات · عربي · الصف الرابع");
  });
  it("omits the not-applicable curriculum for Quran/music lessons", () => {
    expect(
      bookingTeachingSummary(
        {
          teaching_subject_code: "quran_memorization",
          teaching_subject_name_ar: "حفظ",
          teaching_curriculum_code: "na",
          teaching_curriculum_name_ar: "بدون منهج دراسي",
          teaching_level_name_ar: "مبتدئ",
        },
        "ar",
      ),
    ).toBe("حفظ · مبتدئ");
  });
  it("returns null for non-tutoring bookings", () => {
    expect(bookingTeachingSummary({}, "ar")).toBeNull();
  });
});
