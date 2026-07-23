import { describe, expect, it } from "vitest";
import { isValidE164Phone, normalizePhoneE164 } from "../normalizePhone";

describe("normalizePhoneE164", () => {
  it("normalizes equivalent Egyptian formats to the same E.164 value", () => {
    const canonical = "+201221000633";
    expect(normalizePhoneE164("+201221000633")).toBe(canonical);
    expect(normalizePhoneE164("00201221000633")).toBe(canonical);
    expect(normalizePhoneE164("201221000633")).toBe(canonical);
    expect(normalizePhoneE164("01221000633")).toBe(canonical);
    expect(isValidE164Phone(canonical)).toBe(true);
  });

  it("rejects invalid lengths after normalization", () => {
    expect(isValidE164Phone(normalizePhoneE164("123"))).toBe(false);
  });
});
