import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkArLocaleTashkeel, countTashkeel } from "../check-ar-tashkeel.mjs";

const REPO_ROOT = process.cwd();
const AR_PATH = path.join(REPO_ROOT, "src/lib/i18n/locales/ar.ts");

describe("check-ar-tashkeel", () => {
  it("detects tashkeel characters in sample text", () => {
    expect(countTashkeel("حاليًا")).toBe(1);
    expect(countTashkeel("حدّث")).toBe(1);
    expect(countTashkeel("plain Arabic")).toBe(0);
  });

  it("fails when a locale file contains tashkeel", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-tashkeel-"));
    const tmpPath = path.join(tmpDir, "ar.ts");
    fs.writeFileSync(tmpPath, 'export default { key: "حاليًا" };\n', "utf8");

    const result = checkArLocaleTashkeel(tmpPath);
    expect(result.ok).toBe(false);
    expect(result.count).toBeGreaterThan(0);
  });

  it("passes on the repository Arabic locale file", () => {
    const result = checkArLocaleTashkeel(AR_PATH);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
  });

  it("exits non-zero when invoked on a file with tashkeel", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-tashkeel-cli-"));
    const tmpPath = path.join(tmpDir, "ar.ts");
    fs.writeFileSync(tmpPath, 'export default { key: "حدّث" };\n', "utf8");

    const run = spawnSync(process.execPath, ["qa/check-ar-tashkeel.mjs", tmpPath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("tashkeel");
  });
});
