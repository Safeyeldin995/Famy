import { describe, expect, it } from "vitest";
import {
  normalizeOfferingMode,
  offeringModeAllowsInPerson,
  offeringModeAllowsOnline,
} from "../offeringMode";

describe("offeringMode", () => {
  it("defaults unknown values to in_person", () => {
    expect(normalizeOfferingMode("nope")).toBe("in_person");
    expect(normalizeOfferingMode(null)).toBe("in_person");
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