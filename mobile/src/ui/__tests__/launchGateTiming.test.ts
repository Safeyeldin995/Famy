import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAUNCH_GATE_FAIL_SAFE_BUFFER_MS,
  LAUNCH_GATE_INTRO_MS,
  launchGateFailSafeDelayMs,
  scheduleLaunchGateIntroFailSafe,
} from "../launchGateTiming";

describe("launchGateTiming", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the fail-safe at INTRO_MS + 500 ms when motion is enabled", () => {
    expect(launchGateFailSafeDelayMs(false)).toBe(
      LAUNCH_GATE_INTRO_MS + LAUNCH_GATE_FAIL_SAFE_BUFFER_MS,
    );

    const onDone = vi.fn();
    scheduleLaunchGateIntroFailSafe(false, onDone);

    vi.advanceTimersByTime(LAUNCH_GATE_INTRO_MS + LAUNCH_GATE_FAIL_SAFE_BUFFER_MS - 1);
    expect(onDone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("clears the fail-safe when intro cleanup runs before the deadline", () => {
    const onDone = vi.fn();
    const cancel = scheduleLaunchGateIntroFailSafe(false, onDone);

    cancel();
    vi.advanceTimersByTime(LAUNCH_GATE_INTRO_MS + LAUNCH_GATE_FAIL_SAFE_BUFFER_MS);
    expect(onDone).not.toHaveBeenCalled();
  });
});
