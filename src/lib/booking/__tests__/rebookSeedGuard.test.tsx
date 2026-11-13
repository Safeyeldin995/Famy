import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRebookSeedGuard } from "../rebookSeedGuard";

describe("useRebookSeedGuard", () => {
  it("keeps guardDefault and touch stable across rerenders when unseeded", () => {
    const { result, rerender } = renderHook(() => useRebookSeedGuard(undefined));
    const first = result.current;
    rerender();
    expect(result.current.guardDefault).toBe(first.guardDefault);
    expect(result.current.touch).toBe(first.touch);
    expect(first.guardDefault("supervisionMode")).toBe(false);
  });

  it("guards seeded fields until touched", () => {
    const seeded = new Set(["supervisionMode"] as const);
    const { result } = renderHook(() => useRebookSeedGuard(seeded));
    expect(result.current.guardDefault("supervisionMode")).toBe(true);
    result.current.touch("supervisionMode");
    expect(result.current.guardDefault("supervisionMode")).toBe(false);
  });
});
