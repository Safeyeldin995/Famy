export type AdminFilterOption<T extends string> = { value: T; label: string };

export function AdminFilterPills<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: AdminFilterOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-1.5 rounded-lg border border-border/50 bg-surface-2/50 p-1 ${className}`}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`focus-ring rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
              active ? "bg-brand text-brand-foreground shadow-sm" : "text-muted-foreground hover:bg-surface hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
