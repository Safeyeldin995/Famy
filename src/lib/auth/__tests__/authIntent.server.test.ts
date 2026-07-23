import { describe, expect, it } from "vitest";
import { maskPhoneE164 } from "../authIntent.server";

describe("maskPhoneE164", () => {
  it("masks Egyptian numbers for display", () => {
    expect(maskPhoneE164("+201221000633")).toBe("+20 *** *** 0633");
  });
});
