export function hasMissingServicePriceLimits(service: {
  is_active: boolean;
  provider_pricing_allowed: boolean;
  minimum_price: number | null | undefined;
  maximum_price: number | null | undefined;
}): boolean {
  return service.is_active && service.provider_pricing_allowed &&
    (service.minimum_price == null || service.maximum_price == null);
}
