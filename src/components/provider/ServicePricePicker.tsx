import { useTranslation } from "react-i18next";

export function buildPriceOptions(min: number | null, max: number | null): number[] {
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max) || min > max)
    return [];
  const step = max - min <= 300 ? 25 : max - min <= 1000 ? 50 : 100;
  const options: number[] = [min];
  for (let price = (Math.floor(min / step) + 1) * step; price < max; price += step) options.push(price);
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

export function ServicePricePicker({
  min,
  max,
  value,
  onChange,
  unitLabel,
  disabled = false,
}: {
  min: number | null;
  max: number | null;
  value: number | null;
  onChange: (value: number) => void;
  unitLabel: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const options = buildPriceOptions(min, max);
  const floor = Math.max(50, min ?? 50);
  const initial = max == null ? floor : Math.min(floor, max);
  const valid = isPriceInRange(value, min, max);
  const choose = (next: number) => {
    if (isPriceInRange(next, min, max)) onChange(next);
  };
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2">
      <legend className="mb-2 text-xs font-semibold">
        {t("pricePicker.range", { min: min ?? "—", max: max ?? "—", unit: unitLabel })}
      </legend>
      {options.length ? (
        <div className="flex flex-wrap gap-2">
          {options.map((price) => (
            <button
              key={price}
              type="button"
              aria-pressed={value === price}
              onClick={() => onChange(price)}
              className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-bold disabled:opacity-50 ${value === price ? "border-brand bg-brand text-brand-foreground" : "border-border bg-surface"}`}
            >
              {price}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-label={t("pricePicker.decrease")}
            disabled={!valid || value <= (min ?? 50)}
            onClick={() => choose(Math.max(min ?? 50, (value ?? initial) - 50))}
            className="h-11 w-11 rounded-xl border disabled:opacity-50"
          >
            −
          </button>
          <span aria-live="polite" className="text-sm">
            {valid ? `${value} ${unitLabel}` : t("pricePicker.choose")}
          </span>
          <button
            type="button"
            aria-label={t("pricePicker.increase")}
            disabled={valid && max != null && value >= max}
            onClick={() => choose(valid ? Math.min(max ?? Infinity, value + 50) : initial)}
            className="h-11 w-11 rounded-xl border disabled:opacity-50"
          >
            +
          </button>
        </div>
      )}
    </fieldset>
  );
}
