import { describe, expect, it } from "vitest";
import {
  allowedDurationsForSubject,
  bookingFlowQuotesMatch,
  DEFAULT_SESSION_DURATION_MIN,
  formatTeachingCapabilityLine,
  isTutoringCategorySlug,
  tutoringSessionQuote,
} from "../teachingCapabilities";

describe("tutoring teaching capabilities", () => {
  it("hides 180 minutes for subjects capped at 120", () => {
    expect(allowedDurationsForSubject(120, [60, 90, 120, 180])).toEqual([60, 90, 120]);
    expect(allowedDurationsForSubject(120, [60, 90, 120, 180])).not.toContain(180);
  });

  it("allows 180 minutes for math-capped subjects and defaults to 120", () => {
    expect(allowedDurationsForSubject(180, [60, 90, 120, 180])).toEqual([60, 90, 120, 180]);
    expect(DEFAULT_SESSION_DURATION_MIN).toBe(120);
  });

  it("shows the same duration and price in step, summary, and payment", () => {
    const quote = tutoringSessionQuote(120, 450);
    expect(quote.subtotal).toBe(450);
    expect(quote.durationMin).toBe(120);
    expect(
      bookingFlowQuotesMatch(
        tutoringSessionQuote(120, 450),
        tutoringSessionQuote(120, 450),
        tutoringSessionQuote(120, 450),
      ),
    ).toBe(true);
    expect(quote.labelKey).toBe("bookFlow.sessionLine");
  });

  it("formats approved capabilities for search and profile", () => {
    expect(
      formatTeachingCapabilityLine({
        subject: "Mathematics",
        curriculum: "Egyptian National (Arabic)",
        level: "Grade 10 (Secondary 1)",
        durationMin: 180,
        price: 600,
      }),
    ).toBe("Mathematics · Egyptian National (Arabic) · Grade 10 (Secondary 1) — 180 min — EGP 600");
    expect(isTutoringCategorySlug("tutoring")).toBe(true);
    expect(isTutoringCategorySlug("babysitting")).toBe(false);
  });
});
