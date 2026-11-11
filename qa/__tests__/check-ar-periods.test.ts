import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkArabicLocalePeriods,
  findDisallowedDots,
  stripArabicUiPeriods,
} from "../ar-periods.mjs";

const REPO_ROOT = process.cwd();

describe("check-ar-periods", () => {
  it("joins Arabic sentences with the Arabic comma and drops trailing stops", () => {
    expect(stripArabicUiPeriods("الجزء الأول. الجزء الثاني.")).toBe(
      "الجزء الأول، الجزء الثاني",
    );
  });

  it("keeps ellipses, placeholders, URLs, decimals, and ج.م", () => {
    const sample =
      "جار التحميل... من {{price}} ج.م عبر https://famy.app/help والإصدار ١.٠.٠";
    expect(stripArabicUiPeriods(sample)).toBe(sample);
    expect(findDisallowedDots(sample)).toEqual([]);
  });

  it("flags disallowed periods in Arabic UI copy", () => {
    expect(findDisallowedDots("مرحبا.")).toHaveLength(1);
    expect(findDisallowedDots("بانتظارك…")).toHaveLength(0);
  });

  it("passes on the repository Arabic locale files", () => {
    const result = checkArabicLocalePeriods({
      arTsPath: path.join(REPO_ROOT, "src/lib/i18n/locales/ar.ts"),
      arJsonPath: path.join(REPO_ROOT, "mobile/locales/ar.json"),
      listingMdPath: path.join(REPO_ROOT, "mobile/store/listing.ar.md"),
    });
    expect(result.ok).toBe(true);
  });

  it("fails when a locale file contains a disallowed period", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-periods-"));
    const arTsPath = path.join(tmpDir, "ar.ts");
    const arJsonPath = path.join(tmpDir, "ar.json");
    const listingMdPath = path.join(tmpDir, "listing.ar.md");
    fs.writeFileSync(arTsPath, 'export default { key: "مرحبا." };\n', "utf8");
    fs.writeFileSync(arJsonPath, "{}\n", "utf8");
    fs.writeFileSync(listingMdPath, "# عنوان\n", "utf8");

    const result = checkArabicLocalePeriods({ arTsPath, arJsonPath, listingMdPath });
    expect(result.ok).toBe(false);

    const run = spawnSync(process.execPath, ["qa/check-ar-periods.mjs"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
  });
});
