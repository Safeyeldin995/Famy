import type { ReactNode } from "react";
import "./providerApply.css";
export function StickyCta({
  children,
  onClick,
  disabled,
  hint,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="apply-bottom">
      {hint && (
        <p role="status" className="mb-2 text-center text-xs">
          {hint}
        </p>
      )}
      <button type="button" className="apply-cta" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    </div>
  );
}
