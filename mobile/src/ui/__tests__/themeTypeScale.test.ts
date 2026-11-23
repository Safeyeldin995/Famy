import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fontSize, fontSizeTokenForAvatarInitial } from "../theme";

const srcRoot = join(import.meta.dirname, "../..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "__tests__") return walk(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("mobile type scale tokens", () => {
  it("maps avatar initials to named fontSize tokens", () => {
    expect(fontSizeTokenForAvatarInitial(64)).toBe("title");
    expect(fontSizeTokenForAvatarInitial(56)).toBe("xxl");
    expect(fontSizeTokenForAvatarInitial(32)).toBe("lg");
  });

  it("has no numeric fontSize literals in mobile/src", () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const text = readFileSync(file, "utf8");
      if (/\bfontSize\s*:\s*\d/.test(text) || /\bfontSize\s*\.\w+\s*\+/.test(text)) {
        offenders.push(file.slice(srcRoot.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("exposes hero title sizes as tokens", () => {
    expect(fontSize.heroTitle).toBeGreaterThan(fontSize.xxl);
    expect(fontSize.heroTitleLine).toBeGreaterThanOrEqual(fontSize.heroTitle);
  });
});