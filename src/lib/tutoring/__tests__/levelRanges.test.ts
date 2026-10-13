import { describe, expect, it } from "vitest";
import { levelRank, levelRanges } from "../levelRanges";

const lv = (code: string) => ({ code, name: code.toUpperCase() });

describe("levelRanges", () => {
  it("orders KG before grades and grades numerically", () => {
    expect(["g10", "g2", "kg", "g1"].sort((a, b) => levelRank(a) - levelRank(b))).toEqual([
      "kg",
      "g1",
      "g2",
      "g10",
    ]);
  });

  it("collapses consecutive grades into one range", () => {
    expect(levelRanges(["g3", "kg", "g1", "g2", "g6", "g4", "g5"].map(lv))).toEqual([
      { from: "KG", to: "G6" },
    ]);
  });

  it("keeps gaps as separate entries and drops duplicates", () => {
    expect(levelRanges(["g1", "g2", "g2", "g9"].map(lv))).toEqual([
      { from: "G1", to: "G2" },
      { from: "G9" },
    ]);
  });

  it("returns nothing for no levels", () => {
    expect(levelRanges([])).toEqual([]);
  });
});
