import { describe, expect, it } from "vitest";
import { onlineLessonRequestTotal } from "../onlineLessonRequestQuote";

describe("onlineLessonRequestTotal", () => {
  it("matches booking total for a 100 EGP session with default billing (25 fee, 14% VAT)", () => {
    const total = onlineLessonRequestTotal(
      { durationMin: 60, price: 100 },
      { platform_fee: 25, vat_percent: 14 },
    );
    expect(total).toBe(139);
  });
});