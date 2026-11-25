import { describe, expect, it } from "vitest";
import {
  isOfferingModeOptionDisabled,
  isOfferingModeSaveAllowed,
  normalizeOfferingMode,
  offeringModeAllowsInPerson,
  offeringModeAllowsOnline,
} from "../offeringMode";

describe("offeringMode", () => {
  it("defaults unknown values to in_person", () => {
    expect(normalizeOfferingMode("nope")).toBe("in_person");
    expect(normalizeOfferingMode(null)).toBe("in_person");
  });

  it("keeps in-person selectable when online is gated", () => {
    expect(isOfferingModeOptionDisabled("in_person", false)).toBe(false);
    expect(isOfferingModeOptionDisabled("online", false)).toBe(true);
    expect(isOfferingModeOptionDisabled("both", false)).toBe(true);
    expect(isOfferingModeOptionDisabled("online", true)).toBe(false);
    expect(isOfferingModeSaveAllowed("in_person", false)).toBe(true);
    expect(isOfferingModeSaveAllowed("both", false)).toBe(false);
    expect(isOfferingModeSaveAllowed("both", true)).toBe(true);
  });

  it("detects online and in-person availability", () => {
    expect(offeringModeAllowsOnline("both")).toBe(true);
    expect(offeringModeAllowsOnline("online")).toBe(true);
    expect(offeringModeAllowsOnline("in_person")).toBe(false);
    expect(offeringModeAllowsInPerson("both")).toBe(true);
    expect(offeringModeAllowsInPerson("in_person")).toBe(true);
    expect(offeringModeAllowsInPerson("online")).toBe(false);
  });
});