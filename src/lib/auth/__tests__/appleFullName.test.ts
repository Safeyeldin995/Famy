import { describe, expect, it } from "vitest";
import { formatAppleFullName } from "../appleFullName";

describe("formatAppleFullName", () => {
  it("joins given and family names", () => {
    expect(formatAppleFullName({ givenName: "Sara", familyName: "Ali" })).toBe("Sara Ali");
  });

  it("returns null for empty or too-short names", () => {
    expect(formatAppleFullName(null)).toBeNull();
    expect(formatAppleFullName({ givenName: "A" })).toBeNull();
  });
});