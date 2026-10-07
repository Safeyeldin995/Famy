import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./providerApply.css";
export function nextInteger(
  value: number,
  direction: -1 | 1,
  min: number,
  max: number,
  step: number,
) {
  return Math.min(
    Math.floor(max),
    Math.max(Math.ceil(min), Math.round(value) + direction * Math.max(1, Math.round(step))),
  );
}
export function NumberStepper({
  value,
  min,
  max,
  step = 1,
  unitLabel,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unitLabel: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="apply-ui apply-stepper">
      <button
        type="button"
        className="apply-stepper-button"
        aria-label={t("providerSetup.decrease", { unit: unitLabel })}
        disabled={disabled || value <= min}
        onClick={() => onChange(nextInteger(value, -1, min, max, step))}
      >
        <Minus size={18} />
      </button>
      <span className="apply-value">
        <b>{value}</b> <span>{unitLabel}</span>
      </span>
      <button
        type="button"
        className="apply-stepper-button"
        aria-label={t("providerSetup.increase", { unit: unitLabel })}
        disabled={disabled || value >= max}
        onClick={() => onChange(nextInteger(value, 1, min, max, step))}
      >
        <Plus size={18} />
      </button>
    </div>
  );
}
