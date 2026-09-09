import type { ReactNode } from "react";

export function AdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 pb-4">
      <div className="min-w-0">
        <h1 className="text-lg font-extrabold tracking-tight text-foreground">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm font-medium text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
