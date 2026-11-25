import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dirname, "../../app");
const uiRoot = join(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") return [];
      return walk(path);
    }
    return entry.name.endsWith(".tsx") || entry.name.endsWith(".ts") ? [path] : [];
  });
}

const RAW_HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

const GOOGLE_LOGIN_ALLOWLIST = [
  'fill="#FFC107"',
  'fill="#FF3D00"',
  'fill="#4CAF50"',
  'fill="#1976D2"',
];

const FONT_FAMILY_ALLOW =
  /fontFamily:\s*(?:family|familyFor|inputFont|cellFont|tabBarLabelStyle|fonts(?:\[|\.)|useInputFont)/;

const TYPOGRAPHY_HELPER_FILES = new Set(["Text.tsx", "navigationTypography.ts", "useInputFont.ts"]);

function relativeFromMobileSrc(abs: string) {
  const idx = abs.indexOf("/mobile/src/");
  if (idx >= 0) return abs.slice(idx + "/mobile/src/".length);
  return abs;
}

describe("mobile app screen style guardrails", () => {
  const screens = walk(appRoot);
  const uiFiles = walk(uiRoot).filter((p) => !p.endsWith("theme.ts"));

  it("does not use raw fontFamily or fontSize in route screens", () => {
    const offenders: string[] = [];
    for (const file of screens) {
      if (file.endsWith("_layout.tsx")) continue;
      const text = readFileSync(file, "utf8");
      if (/\bfontFamily\s*:/.test(text) || /\bfontSize\s*:\s*\d+/.test(text)) {
        offenders.push(file.slice(appRoot.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("blocks admin accounts from customer and provider stacks", () => {
    const customerLayout = readFileSync(join(appRoot, "(customer)/_layout.tsx"), "utf8");
    const providerLayout = readFileSync(join(appRoot, "(provider)/_layout.tsx"), "utf8");
    expect(customerLayout).toContain("useAdminOnlyMobileBlock");
    expect(providerLayout).toContain("useAdminOnlyMobileBlock");
  });

  it("avoids physical left/right layout props in route screens", () => {
    const offenders: string[] = [];
    for (const file of screens) {
      const text = readFileSync(file, "utf8");
      if (
        /\b(margin|padding)(Left|Right)\s*:/.test(text) ||
        /\btextAlign\s*:\s*"(left|right)"/.test(text)
      ) {
        offenders.push(file.slice(appRoot.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not use raw hex colors outside theme tokens", () => {
    const offenders: string[] = [];
    const sources = [...screens, ...uiFiles];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!RAW_HEX.test(line)) continue;
        if (GOOGLE_LOGIN_ALLOWLIST.some((allow) => line.includes(allow))) continue;
        if (/colors\.[a-zA-Z0-9_]+/.test(line) && !/["']#[0-9a-fA-F]/.test(line)) continue;
        offenders.push(`${relativeFromMobileSrc(file)}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not use raw numeric fontSize in shared UI", () => {
    const offenders: string[] = [];
    for (const file of uiFiles) {
      if (TYPOGRAPHY_HELPER_FILES.has(file.split("/").pop()!)) continue;
      const text = readFileSync(file, "utf8");
      if (/\bfontSize\s*:\s*\d+/.test(text)) {
        offenders.push(relativeFromMobileSrc(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("sets fontFamily only through typography helpers in shared UI", () => {
    const offenders: string[] = [];
    for (const file of uiFiles) {
      const base = file.split("/").pop()!;
      if (TYPOGRAPHY_HELPER_FILES.has(base)) continue;
      const text = readFileSync(file, "utf8");
      if (!/\bfontFamily\s*:/.test(text)) continue;
      const allowed =
        FONT_FAMILY_ALLOW.test(text) ||
        /\bfonts\.(ar|en)\b/.test(text) ||
        text.includes("familyFor(");
      if (!allowed) offenders.push(relativeFromMobileSrc(file));
    }
    expect(offenders).toEqual([]);
  });
});
