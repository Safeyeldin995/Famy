import { describe, expect, it } from "vitest";
import {
  isStarFilled,
  ratingLabelKey,
  starRowDirection,
} from "@shared/ui/starRating";

describe("starRating helpers", () => {
  it("mirrors star row direction in Arabic", () => {
    expect(starRowDirection("ar")).toBe("row-reverse");
    expect(starRowDirection("en")).toBe("row");
  });

  it("fills stars up to the selected value", () => {
    expect(isStarFilled(1, 3)).toBe(true);
    expect(isStarFilled(4, 3)).toBe(false);
    expect(isStarFilled(3, 0)).toBe(false);
  });

  it("maps label keys for each star value", () => {
    expect(ratingLabelKey(5)).toBe("mobileBooking.starLabel5");
  });
});
