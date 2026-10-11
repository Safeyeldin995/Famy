import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDuration,
  formatEGP,
  formatNotificationDate,
  formatNumber,
  formatTime,
} from "./index";

describe("Egyptian display formatting", () => {
  const date = new Date(2026, 8, 2, 14, 0, 49);

  it("uses Latin digits with Arabic currency and day/month names", () => {
    expect(formatEGP(3240, undefined, "ar")).toBe("3,240 ج.م");
    expect(formatDate(date, undefined, "ar")).toBe("الأربعاء 2 سبتمبر");
    expect(formatNumber(3240, "ar")).toBe("3,240");
  });

  it("never mixes Arabic-Indic digits and abbreviated English durations", () => {
    const label = `${formatTime(date, "ar")} · ${formatDuration(3, "ar")}`;
    expect(label).toBe("2 م · 3 ساعات");
    expect(label).not.toMatch(/[\u0660-\u0669]|3h/);
    expect(formatDuration(3, "en")).toBe("3 hours");
    expect(formatDuration(1, "en")).toBe("1 hour");
  });

  it("keeps minutes when needed and never displays seconds", () => {
    expect(formatTime(new Date(2026, 8, 2, 14, 30, 49), "ar")).toBe("2:30 م");
    expect(formatTime(date, "en").toLowerCase()).toBe("2 pm");
  });

  it("uses calendar-relative notification dates across month boundaries", () => {
    const now = new Date(2026, 9, 1, 15);
    expect(formatNotificationDate(new Date(2026, 9, 1, 14), now, "ar")).toBe("النهارده · 2 م");
    expect(formatNotificationDate(new Date(2026, 8, 30, 14), now, "ar")).toBe("امبارح · 2 م");
    expect(formatNotificationDate(date, now, "ar")).toBe("الأربعاء 2 سبتمبر · 2 م");
  });
});
