import { Check } from "lucide-react";
import type { ReactNode } from "react";
import "./providerApply.css";
export function ServiceCard({
  selected,
  title,
  subtitle,
  icon,
  children,
  onClick,
  disabled,
}: {
  selected: boolean;
  title: string;
  subtitle: string;
  icon: ReactNode;
  children?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={`apply-service ${selected ? "on" : ""}`}>
      <button
        type="button"
        className="apply-service-row"
        onClick={onClick}
        aria-pressed={selected}
        disabled={disabled}
      >
        <span className="apply-tile">{icon}</span>
        <span className="apply-service-text">
          <b>{title}</b>
          <small>{subtitle}</small>
        </span>
        <span className={`apply-checkbox ${selected ? "on" : ""}`}>
          {selected && <Check size={14} />}
        </span>
      </button>
      {selected && children}
    </div>
  );
}
