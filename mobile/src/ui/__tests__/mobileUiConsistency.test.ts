import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dirname, "../../app");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("mobile app screen style guardrails", () => {
  const screens = walk(appRoot);

  it("does not use raw fontFamily or fontSize in route screens", () => {
    const offenders: string[] = [];
    for (const file of screens) {
      if (file.endsWith("_layout.tsx")) continue;
      const text = readFileSync(file, "utf8");
      if (/\bfontFamily\s*:/.test(text) || /\bfontSize\s*:/.test(text)) {
        offenders.push(file.slice(appRoot.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("avoids physical left/right layout props in route screens", () => {
    const offenders: string[] = [];
    for (const file of screens) {
      const text = readFileSync(file, "utf8");
      if (/\b(margin|padding)(Left|Right)\s*:/.test(text) || /\btextAlign\s*:\s*"(left|right)"/.test(text)) {
        offenders.push(file.slice(appRoot.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
