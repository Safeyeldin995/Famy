import { describe, expect, it } from "vitest";
import { providerPerformanceTipKey } from "../performanceStats";

describe("providerPerformanceTipKey", () => {
  it("prefers acceptance tip when rate is low", () => {
    const tip = providerPerformanceTipKey({ acceptance_rate: 60, completion_rate: 95 });
    expect(tip?.key).toBe("proPerformance.tipAcceptance");
    expect(tip?.params).toEqual({ rate: 60 });
  });

  it("returns null when metrics are healthy", () => {
    expect(
      providerPerformanceTipKey({
        acceptance_rate: 90,
        median_response_minutes: 20,
        completion_rate: 98,
        provider_cancellation_rate: 2,
        rating_avg: 4.8,
        rating_count: 10,
      }),
    ).toBeNull();
  });
});