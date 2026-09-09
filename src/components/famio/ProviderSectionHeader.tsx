import type { ReactNode } from "react";

export function ProviderSectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-sm font-extrabold tracking-tight text-foreground">{title}</h2>
      {action}
    </div>
  );
}
