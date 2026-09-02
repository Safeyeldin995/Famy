import { describe, expect, it, vi } from "vitest";
import { runPaymobReturnPolling } from "../paymobReturnPolling";

describe("runPaymobReturnPolling", () => {
  it("polls through all 15 attempts even when payment status stays pending across refetches", () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    let status = "pending";

    runPaymobReturnPolling({
      enabled: true,
      isOnline: true,
      getPaymentStatus: () => status,
      refetch,
      intervalMs: 2000,
      maxAttempts: 15,
      setIntervalFn: (fn, ms) => setInterval(fn, ms),
      clearIntervalFn: (id) => clearInterval(id),
    });

    for (let attempt = 1; attempt <= 15; attempt += 1) {
      status = attempt % 2 === 0 ? "pending" : "pending_review";
      vi.advanceTimersByTime(2000);
      expect(refetch).toHaveBeenCalledTimes(attempt);
    }

    vi.advanceTimersByTime(2000);
    expect(refetch).toHaveBeenCalledTimes(15);
    vi.useRealTimers();
  });

  it("stops early when payment becomes captured", () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    let status: string | undefined = "pending";

    runPaymobReturnPolling({
      enabled: true,
      isOnline: true,
      getPaymentStatus: () => status,
      refetch,
      intervalMs: 1000,
      maxAttempts: 15,
    });

    vi.advanceTimersByTime(1000);
    expect(refetch).toHaveBeenCalledTimes(1);
    status = "captured";
    vi.advanceTimersByTime(1000);
    expect(refetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(refetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
