import { describe, expect, it } from "vitest";
import {
  applyBasicsReady,
  normalizeApplyWorkMode,
  serviceAllowedForMode,
  servicesForMode,
} from "../applyWorkMode";

const quran = { id: "q", online_allowed: true, category: { online_allowed: true } };
const cleaning = { id: "c", online_allowed: false, category: { online_allowed: false } };

describe("applyWorkMode", () => {
  it("normalizes unknown modes to in person", () => {
    expect(normalizeApplyWorkMode("online")).toBe("online");
    expect(normalizeApplyWorkMode("both")).toBe("both");
    expect(normalizeApplyWorkMode(null)).toBe("in_person");
    expect(normalizeApplyWorkMode("weird")).toBe("in_person");
  });

  it("shows only online services to an online-only applicant", () => {
    expect(servicesForMode([quran, cleaning], "online").map((s) => s.id)).toEqual(["q"]);
    expect(servicesForMode([quran, cleaning], "both").map((s) => s.id)).toEqual(["q", "c"]);
    expect(serviceAllowedForMode(cleaning, "in_person")).toBe(true);
  });

  it("needs zones for at-home work and a governorate for online work", () => {
    const base = { name: "Mona", mode: "in_person" as const, governorate: "", zones: ["z"] };
    expect(applyBasicsReady(base)).toBe(true);
    expect(applyBasicsReady({ ...base, zones: [] })).toBe(false);
    expect(applyBasicsReady({ ...base, mode: "online", zones: [] })).toBe(false);
    expect(applyBasicsReady({ ...base, mode: "online", zones: [], governorate: "asyut" })).toBe(true);
    expect(applyBasicsReady({ ...base, mode: "both", governorate: "asyut", zones: [] })).toBe(false);
    expect(applyBasicsReady({ ...base, mode: "both", governorate: "asyut" })).toBe(true);
    expect(applyBasicsReady({ ...base, name: " " })).toBe(false);
  });
});
