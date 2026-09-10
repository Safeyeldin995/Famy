import type { ReactNode } from "react";

export function AdminCard({
  children,
  className = "",
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-border/50 bg-surface shadow-sm ${padding ? "p-4" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
