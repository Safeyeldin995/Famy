import { describe, expect, it } from "vitest";
import path from "node:path";
import { checkArabicLocalePlurals } from "../ar-plurals.mjs";

const REPO_ROOT = process.cwd();

describe("check-ar-plurals", () => {
  it("passes on the repository Arabic locale file", () => {
    const result = checkArabicLocalePlurals({
      arTsPath: path.join(REPO_ROOT, "src/lib/i18n/locales/ar.ts"),
    });
    expect(result.ok).toBe(true);
  });
});
