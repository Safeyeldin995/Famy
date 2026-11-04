import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) return [path];
    return [];
  });
}

describe("mobile Hermes-safe crypto", () => {
  it("does not call global crypto.randomUUID in mobile/src", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const offenders = sourceFiles(root).filter(
      (file) =>
        !file.replaceAll("\\", "/").includes("/__tests__/") &&
        readFileSync(file, "utf8").includes("crypto.randomUUID("),
    );
    expect(offenders).toEqual([]);
  });
});
