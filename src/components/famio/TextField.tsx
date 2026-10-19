import type { InputHTMLAttributes } from "react";
import "./providerApply.css";
export function TextField({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label>
      <span className="apply-label">{label}</span>
      <input {...props} className="apply-input" />
    </label>
  );
}
