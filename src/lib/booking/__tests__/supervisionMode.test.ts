import { describe, expect, it } from "vitest";
import {
  requiresSupervisionMode,
  isSupervisionMode,
  SUPERVISION_MODES,
} from "../supervisionMode";

describe("supervisionMode helpers", () => {
  it("requires supervision for babysitting and tutoring only", () => {
    expect(requiresSupervisionMode("babysitting")).toBe(true);
    expect(requiresSupervisionMode("tutoring")).toBe(true);
    expect(requiresSupervisionMode("home-cleaning")).toBe(false);
    expect(requiresSupervisionMode(null)).toBe(false);
  });

  it("recognizes allowed RPC values", () => {
    for (const mode of SUPERVISION_MODES) {
      expect(isSupervisionMode(mode)).toBe(true);
    }
    expect(isSupervisionMode("")).toBe(false);
    expect(isSupervisionMode("other")).toBe(false);
  });
});
