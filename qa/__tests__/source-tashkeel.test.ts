import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkArLocaleTashkeel } from "../check-ar-tashkeel.mjs";
const folders: string[] = [];
afterEach(() =>
  folders.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);
it("finds shadda and vowel marks in nested TS and TSX, including non-locale source", () => {
  const root = mkdtempSync(join(tmpdir(), "famy-source-tashkeel-"));
  folders.push(root);
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "screen.tsx"), `export const label = "حد\u0651ث";`);
  writeFileSync(join(root, "other.ts"), `export const label = "حالي\u064bا";`);
  writeFileSync(join(root, "ignored.md"), "\u0651");
  expect(checkArLocaleTashkeel(root)).toMatchObject({ ok: false, count: 2 });
  writeFileSync(join(root, "nested", "screen.tsx"), `export const label = "حدث";`);
  writeFileSync(join(root, "other.ts"), `export const label = "حاليا";`);
  expect(checkArLocaleTashkeel(root)).toMatchObject({ ok: true, count: 0 });
});
