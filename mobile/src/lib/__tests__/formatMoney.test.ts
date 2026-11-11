import { describe, expect, it } from "vitest";
import { formatEGP } from "@shared/format/egp";
import { providerRatingSummary } from "@/lib/providerRating";

describe("shared money and rating presentation", () => {
  it("formats Arabic currency after the number without trailing decimals", () => {
    expect(formatEGP(400, undefined, "ar")).toBe("400 ج.م");
    expect(formatEGP(511.5, undefined, "ar")).toBe("511.5 ج.م");
    expect(formatEGP(150, { perHour: true }, "ar")).toBe("150 ج.م / الساعة");
  });

  it("formats provider ratings with the review count after the average", () => {
    expect(providerRatingSummary(4.8, "تقييمين", "ar")).toBe("4.8، تقييمين");
    expect(providerRatingSummary(4.8, "2 reviews", "en")).toBe("4.8 · 2 reviews");
  });
});
