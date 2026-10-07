import { expect, it } from "vitest";
import { hasMissingServicePriceLimits } from "../servicePriceLimits";

it.each([
  [null, null],
  [100, null],
  [null, 500],
  [undefined, 500],
])("warns for missing limits %s–%s", (minimum_price, maximum_price) => {
  expect(
    hasMissingServicePriceLimits({
      is_active: true,
      provider_pricing_allowed: true,
      minimum_price,
      maximum_price,
    }),
  ).toBe(true);
});
it("does not warn for configured, inactive or Admin-priced services", () => {
  const service = {
    is_active: true,
    provider_pricing_allowed: true,
    minimum_price: 0,
    maximum_price: 500,
  };
  expect(hasMissingServicePriceLimits(service)).toBe(false);
  expect(hasMissingServicePriceLimits({ ...service, minimum_price: null, is_active: false })).toBe(
    false,
  );
  expect(
    hasMissingServicePriceLimits({
      ...service,
      maximum_price: null,
      provider_pricing_allowed: false,
    }),
  ).toBe(false);
});
