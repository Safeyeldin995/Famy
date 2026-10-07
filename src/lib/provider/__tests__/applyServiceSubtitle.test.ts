import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { applyServiceSubtitle } from "../applyServiceSubtitle";

describe("apply service subtitles", () => {
  it.each([
    [
      "en",
      "Hourly price",
      "Price per session",
      "8 continuous hours · fixed price",
      "6 PM to midnight · fixed price",
    ],
    [
      "ar",
      "السعر بالساعة",
      "السعر بالحصة",
      "8 ساعات متواصلة · سعر ثابت",
      "من 6 م لحد 12 بالليل · سعر ثابت",
    ],
  ])(
    "uses concise %s subtitles without repeating titles or stepper units",
    (language, hourly, tutoring, fullDay, overnight) => {
      const t = i18n.getFixedT(language);
      expect(applyServiceSubtitle({ pricing_model: "hourly" }, t)).toBe(hourly);
      expect(applyServiceSubtitle({ category: { slug: "tutoring" } }, t)).toBe(tutoring);
      expect(applyServiceSubtitle({ pricing_model: "fixed", duration_min: 480 }, t)).toBe(fullDay);
      expect(
        applyServiceSubtitle(
          { pricing_model: "fixed", duration_min: 360, fixed_start_time: "18:00:00" },
          t,
        ),
      ).toBe(overnight);
    },
  );

  it("derives duration and both clock labels from service data", () => {
    const continuous = { pricing_model: "fixed", duration_min: 270 };
    const timed = { ...continuous, fixed_start_time: "09:30:00" };
    expect(applyServiceSubtitle(continuous, i18n.getFixedT("en"))).toBe(
      "4.5 continuous hours · fixed price",
    );
    expect(applyServiceSubtitle(timed, i18n.getFixedT("en"))).toBe("9:30 AM to 2 PM · fixed price");
    expect(applyServiceSubtitle(timed, i18n.getFixedT("ar"))).toBe("من 9:30 ص لحد 2 م · سعر ثابت");
  });
});
