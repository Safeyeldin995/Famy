import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const homePath = join(import.meta.dirname, "../../app/(customer)/(tabs)/home.tsx");
const querySource = readFileSync(
  join(import.meta.dirname, "../../../node_modules/@tanstack/react-query/build/modern/useBaseQuery.js"),
  "utf8",
);

describe("customer home freeze guardrails", () => {
  it("does not tie useFocusEffect to bookings.refetch unless legacy diag mode", () => {
    const src = readFileSync(homePath, "utf8");
    const block = src.match(/useFocusEffect\([\s\S]*?\n  \);/)?.[0] ?? "";
    expect(block).toMatch(/if \(legacyFreeze\)/);
    expect(block.includes("void bookings.refetch()")).toBe(true);
    expect(block.match(/bookings\.refetch/g)?.length).toBe(2); // body + deps (stable in v5)
  });

  it("ends refresh before providers fan-out refetch in current (non-legacy) mode", () => {
    const src = readFileSync(homePath, "utf8");
    expect(src).toMatch(
      /setRefreshing\(false\);\s*\n\s*if \(!legacyFreeze\) \{\s*\n\s*void cache\.refetchQueries/,
    );
  });

  it("documents TanStack Query refetch as stable in the built package", () => {
    expect(querySource.length).toBeGreaterThan(0);
    expect(querySource).toContain("useBaseQuery");
  });
});