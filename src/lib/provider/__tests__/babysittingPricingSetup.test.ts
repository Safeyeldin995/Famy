import { describe, expect, it } from "vitest";
import { FIXTURE_HOURLY_RATE, planFixtureProviderPricing } from "./babysittingCapabilities.harness";

describe("planFixtureProviderPricing", () => {
  it("uses hourly_rate only when the service disallows provider-set pricing", () => {
    expect(
      planFixtureProviderPricing({
        provider_pricing_allowed: false,
        minimum_price: null,
        maximum_price: null,
      }),
    ).toEqual({ hourlyRate: FIXTURE_HOURLY_RATE, priceOverride: null });
  });

  it("sets an in-range price_override when the service allows provider-set pricing", () => {
    expect(
      planFixtureProviderPricing({
        provider_pricing_allowed: true,
        minimum_price: 80,
        maximum_price: 120,
      }),
    ).toEqual({ hourlyRate: FIXTURE_HOURLY_RATE, priceOverride: FIXTURE_HOURLY_RATE });
  });

  it("clamps the supported rate to the service minimum and maximum", () => {
    expect(
      planFixtureProviderPricing({
        provider_pricing_allowed: true,
        minimum_price: 150,
        maximum_price: null,
      }),
    ).toEqual({ hourlyRate: 150, priceOverride: 150 });
    expect(
      planFixtureProviderPricing({
        provider_pricing_allowed: true,
        minimum_price: null,
        maximum_price: 80,
      }),
    ).toEqual({ hourlyRate: 80, priceOverride: 80 });
  });

  it("never plans a price_override for a disallowed service even when limits exist", () => {
    expect(
      planFixtureProviderPricing({
        provider_pricing_allowed: false,
        minimum_price: 150,
        maximum_price: 200,
      }),
    ).toEqual({ hourlyRate: 150, priceOverride: null });
  });

  it("rejects inverted service limits", () => {
    expect(() =>
      planFixtureProviderPricing({
        provider_pricing_allowed: true,
        minimum_price: 200,
        maximum_price: 50,
      }),
    ).toThrow(/inverted/i);
  });
});
