import { useEffect } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buildPriceOptions, isPriceInRange } from "@/lib/provider/priceOptions";
import { BottomSheetSelect } from "./BottomSheetSelect";
import "./providerApply.css";
export function initialStepperPrice(min: number | null, max: number | null) {
  const options = buildPriceOptions(min, max);
  if (!options.length) return Math.min(max ?? Infinity, Math.max(50, min ?? 50));
  const midpoint = (min! + max!) / 2;
  return options.reduce((best, price) =>
    Math.abs(price - midpoint) < Math.abs(best - midpoint) ? price : best,
  );
}
export function stepperPrice(
  value: number,
  direction: -1 | 1,
  min: number | null,
  max: number | null,
) {
  const options = buildPriceOptions(min, max);
  if (options.length)
    return direction === 1
      ? (options.find((p) => p > value) ?? max!)
      : ([...options].reverse().find((p) => p < value) ?? min!);
  return Math.max(min ?? 50, Math.min(max ?? Infinity, value + direction * 50));
}
export function PriceStepper({
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
  const initial = initialStepperPrice(min, max);
  useEffect(() => {
    if (value == null && !disabled && isPriceInRange(initial, min, max)) onChange(initial);
  }, [value, disabled, initial, min, max, onChange]);
  const shown = value ?? initial;
  const bounded = buildPriceOptions(min, max);
  const options = bounded.length
    ? bounded
    : Array.from(
        { length: Math.ceil(Math.max(1000, shown + 500) / 50) },
        (_, i) => (i + 1) * 50,
      ).filter((p) => isPriceInRange(p, min, max));
  const choose = (next: number) => {
    if (isPriceInRange(next, min, max)) onChange(next);
  };
  return (
    <div className="apply-ui apply-stepper">
      <button
        type="button"
        className="apply-stepper-button"
        aria-label={t("pricePicker.decrease")}
        disabled={disabled || shown <= (min ?? 50)}
        onClick={() => choose(stepperPrice(shown, -1, min, max))}
      >
        <Minus size={18} />
      </button>
      <BottomSheetSelect
        disabled={disabled}
        label={t("pricePicker.choose")}
        value={String(shown)}
        options={options.map((price) => ({ value: String(price), label: `${price} ${unitLabel}` }))}
        onChange={(price) => choose(Number(price))}
        trigger={
          <>
            <b>{shown}</b> <span>{unitLabel}</span>
            {min != null && max != null && <small>{t("providerApply.range", { min, max })}</small>}
          </>
        }
      />
      <button
        type="button"
        className="apply-stepper-button"
        aria-label={t("pricePicker.increase")}
        disabled={disabled || (max != null && shown >= max)}
        onClick={() => choose(stepperPrice(shown, 1, min, max))}
      >
        <Plus size={18} />
      </button>
    </div>
  );
}
