import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BODY_FONT_SCALE_CAP,
  COMPACT_FONT_SCALE_CAP,
  maxFontSizeMultiplierForText,
} from "../a11y";

const textPath = join(import.meta.dirname, "../Text.tsx");

describe("Text font scale cap", () => {
  it("caps default body text at 1.15", () => {
    expect(BODY_FONT_SCALE_CAP).toBe(1.15);
    expect(maxFontSizeMultiplierForText({ size: "md" })).toBe(1.15);
  });

  it("caps headings and bold at 1.1", () => {
    expect(COMPACT_FONT_SCALE_CAP).toBe(1.1);
    expect(maxFontSizeMultiplierForText({ size: "title" })).toBe(1.1);
    expect(maxFontSizeMultiplierForText({ size: "md", weight: "bold" })).toBe(1.1);
  });

  it("passes maxFontSizeMultiplier through Text", () => {
    const src = readFileSync(textPath, "utf8");
    expect(src).toContain("maxFontSizeMultiplier={maxFontSizeMultiplierForText");
    expect(src).toContain("allowFontScaling");
  });
});