import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression: nested <button> inside <Link> breaks mobile navigation (Phase A / Issue #86).
 */
describe("family-members list add action", () => {
  it("uses navigate on PrimaryButton instead of Link wrapping a button", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../family-members.tsx"), "utf8");
    expect(src).not.toMatch(/<Link to="\/family-members\/new">\s*\n\s*<PrimaryButton/);
    expect(src).toMatch(/nav\(\{ to: "\/family-members\/new" \}\)/);
  });
});
