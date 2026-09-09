import type { ReactNode } from "react";

export function ProviderFloatingPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative z-10 -mt-8 rounded-[1.25rem] border border-border/40 bg-surface p-4 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}
