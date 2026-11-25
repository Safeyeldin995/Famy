import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ar from "../locales/ar";
import en from "../locales/en";

const ROOT = join(import.meta.dirname, "../../../..");

function flattenLocaleKeys(obj: unknown, prefix = ""): Set<string> {
  const keys = new Set<string>();
  if (!obj || typeof obj !== "object") return keys;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flattenLocaleKeys(v, path).forEach((x) => keys.add(x));
    } else {
      keys.add(path);
    }
  }
  return keys;
}

function extractTranslationKeysFromSource(source: string): string[] {
  const keys: string[] = [];
  const quoted = /\bt\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = quoted.exec(source)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

function collectOnlineRouteSources(): string[] {
  const routesDir = join(ROOT, "src/routes");
  const onlineDir = join(ROOT, "src/components/online");
  const paths: string[] = [];
  for (const name of readdirSync(routesDir)) {
    if (name.startsWith("online")) {
      paths.push(join(routesDir, name));
    }
  }
  for (const name of readdirSync(onlineDir)) {
    paths.push(join(onlineDir, name));
  }
  return paths;
}

const enKeys = flattenLocaleKeys(en);
const arKeys = flattenLocaleKeys(ar);

describe("online web route i18n", () => {
  it("resolves every static t() key used under routes/online* and components/online", () => {
    const seen = new Set<string>();
    for (const file of collectOnlineRouteSources()) {
      const source = readFileSync(file, "utf8");
      for (const key of extractTranslationKeysFromSource(source)) {
        if (key.includes("${") || key.includes("`")) continue;
        if (!key.startsWith("onlineWeb.") && !key.startsWith("auth.")) continue;
        seen.add(key);
        expect(enKeys.has(key), `en missing ${key} (from ${file})`).toBe(true);
        expect(arKeys.has(key), `ar missing ${key} (from ${file})`).toBe(true);
      }
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it("exposes onlineWeb at translation root (not under admin)", () => {
    expect(en).toHaveProperty("onlineWeb.title");
    expect(ar).toHaveProperty("onlineWeb.title");
    expect((en as { admin?: { onlineWeb?: unknown } }).admin?.onlineWeb).toBeUndefined();
  });
});