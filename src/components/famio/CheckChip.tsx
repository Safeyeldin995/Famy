import { Check } from "lucide-react";
import type { ReactNode } from "react";
import "./providerApply.css";
export function CheckChip({
  selected,
  children,
  onClick,
  disabled,
}: {
  selected: boolean;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
      className={`apply-chip ${selected ? "on" : ""}`}
    >
      {selected && (
        <span className="apply-dot">
          <Check size={11} strokeWidth={3} />
        </span>
      )}
      {children}
    </button>
  );
}
