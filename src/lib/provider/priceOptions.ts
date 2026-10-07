export function buildPriceOptions(min: number | null, max: number | null): number[] {
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max) || min > max)
    return [];
  const step = max - min <= 300 ? 25 : max - min <= 1000 ? 50 : 100;
  const options: number[] = [min];
  for (let price = (Math.floor(min / step) + 1) * step; price < max; price += step)
    options.push(price);
  if (max !== min) options.push(max);
  return options;
}

export function isPriceInRange(
  value: number | null | undefined,
  min: number | null,
  max: number | null,
): value is number {
  return (
    value != null &&
    Number.isFinite(value) &&
    value > 0 &&
    (min == null || value >= min) &&
    (max == null || value <= max)
  );
}

export function isSavedPriceOutOfRange(
  value: number | null | undefined,
  min: number | null,
  max: number | null,
) {
  return value != null && !isPriceInRange(value, min, max);
}

type PricedService = {
  id: string;
  provider_pricing_allowed?: boolean | null;
  minimum_price?: number | null;
  maximum_price?: number | null;
  category?: { slug?: string | null } | null;
};
export function needsServicePrice(service: PricedService) {
  return !!service.provider_pricing_allowed && service.category?.slug !== "tutoring";
}
export function hasSelectedServicePrices(
  services: PricedService[],
  selectedIds: string[],
  prices: Record<string, number | null | undefined>,
) {
  return selectedIds.every((id) => {
    const service = services.find((item) => item.id === id);
    return (
      !!service &&
      (!needsServicePrice(service) ||
        isPriceInRange(prices[id], service.minimum_price ?? null, service.maximum_price ?? null))
    );
  });
}
