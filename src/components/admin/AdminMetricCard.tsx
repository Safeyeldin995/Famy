import type { LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { adminPath } from "@/lib/preview/previewPath";
import type { AdminTone } from "./statusTones";
import { adminToneClass } from "./statusTones";

export function AdminMetricCard({
  icon: Icon,
  label,
  value,
  tone = "brand",
  to,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: AdminTone;
  to?: string;
  hint?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-2">
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${adminToneClass(tone)}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-extrabold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs font-medium text-muted-foreground">{hint}</p> : null}
    </>
  );

  const className =
    "block rounded-xl border border-border/50 bg-surface p-4 shadow-sm transition-colors hover:border-brand/25";

  if (to) {
    return (
      <Link to={adminPath(to) as "/admin"} className={`focus-ring ${className}`}>
        {inner}
      </Link>
    );
  }

  return <div className={className}>{inner}</div>;
}
