import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNowTick } from "../useNowTick";

describe("useNowTick", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("re-renders on each interval so join-window checks update without a refresh", () => {
    const { result } = renderHook(() => useNowTick(30_000));
    const first = result.current;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBeGreaterThan(first);
  });
});
