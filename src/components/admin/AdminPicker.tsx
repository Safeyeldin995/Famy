import {
  Children,
  isValidElement,
  useState,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronDown, Check } from "lucide-react";
import { CatalogSheet } from "./CatalogControls";

/** Same option values and change contract as select, with a keyboard-accessible sheet. */
export function AdminPicker({
  children,
  value,
  onChange,
  className,
  disabled,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const [open, setOpen] = useState(false);
  const options: Array<{ value: string; label: ReactNode; disabled?: boolean }> = [];
  function collect(nodes: ReactNode) {
    Children.forEach(nodes, (child) => {
      if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child))
        return;
      if (child.type === "option")
        options.push({
          value: String(child.props.value ?? ""),
          label: child.props.children,
          disabled: child.props.disabled,
        });
      else collect(child.props.children);
    });
  }
  collect(children);
  const selected = options.find((option) => option.value === String(value ?? ""));
  return (
    <>
      <button
        type="button"
        id={props.id}
        disabled={disabled}
        aria-label={props["aria-label"]}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`flex min-h-11 min-w-0 items-center justify-between gap-2 text-start ${className ?? "rounded-xl border px-3 text-sm"}`}
      >
        <span className="truncate">{selected?.label ?? "—"}</span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </button>
      {open && (
        <CatalogSheet
          title={String(
            props["aria-label"] ?? (typeof selected?.label === "string" ? selected.label : ""),
          )}
          description=""
          onClose={() => setOpen(false)}
        >
          <div className="space-y-1">
            {options.map((option) => (
              <button
                type="button"
                key={option.value}
                disabled={option.disabled}
                aria-pressed={option.value === String(value ?? "")}
                className="flex min-h-11 w-full items-center justify-between rounded-xl border p-3 text-start text-sm"
                onClick={() => {
                  onChange?.({
                    target: { value: option.value },
                    currentTarget: { value: option.value },
                  } as React.ChangeEvent<HTMLSelectElement>);
                  setOpen(false);
                }}
              >
                {option.label}
                {option.value === String(value ?? "") && <Check className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </CatalogSheet>
      )}
    </>
  );
}
