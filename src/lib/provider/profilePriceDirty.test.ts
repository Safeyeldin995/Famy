import { expect, it } from "vitest";
import { profilePriceDirty } from "./profilePriceDirty";
it("offers Save only for an explicit changed price, including an unset saved price", () => {
  expect(profilePriceDirty(undefined, 150)).toBe(false);
  expect(profilePriceDirty(undefined, null)).toBe(false);
  expect(profilePriceDirty(150, 150)).toBe(false);
  expect(profilePriceDirty(175, 150)).toBe(true);
  expect(profilePriceDirty(150, null)).toBe(true);
  expect(profilePriceDirty(0, null)).toBe(true);
});
