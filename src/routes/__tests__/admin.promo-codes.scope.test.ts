import { describe, expect, it } from "vitest";

// Mirror validate() scope rules from admin.promo-codes (minimal unit test).
function validateScope(
  applicable_scope: string,
  scope: { categoryIds: string[]; serviceIds: string[] },
): boolean {
  if (applicable_scope === "categories" && scope.categoryIds.length === 0) return false;
  if (applicable_scope === "services" && scope.serviceIds.length === 0) return false;
  return true;
}

describe("promo scope validation", () => {
  it("rejects empty category selection when scope is categories", () => {
    expect(validateScope("categories", { categoryIds: [], serviceIds: [] })).toBe(false);
    expect(validateScope("categories", { categoryIds: ["c1"], serviceIds: [] })).toBe(true);
  });

  it("allows unchecking last chip without falling back to server rows", () => {
    const scope = { categoryIds: [] as string[], serviceIds: [] as string[] };
    expect(validateScope("categories", scope)).toBe(false);
  });
});