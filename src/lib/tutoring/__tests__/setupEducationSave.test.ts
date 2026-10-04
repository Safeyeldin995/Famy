import { describe, expect, it } from "vitest";
import { canPersistSetupEducationProfile } from "../setupEducationSave";

describe("setup education save gate", () => {
  it("blocks upsert while the education query is unresolved or errored", () => {
    expect(canPersistSetupEducationProfile({ isSuccess: false, isError: false })).toBe(false);
    expect(canPersistSetupEducationProfile({ isSuccess: false, isError: true })).toBe(false);
    expect(canPersistSetupEducationProfile({ isSuccess: true, isError: true })).toBe(false);
  });

  it("allows upsert once the education query succeeded", () => {
    expect(canPersistSetupEducationProfile({ isSuccess: true, isError: false })).toBe(true);
  });
});
