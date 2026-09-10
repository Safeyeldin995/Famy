import type { ReactNode } from "react";

export function CustomerFloatingPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative z-10 -mt-10 rounded-[1.5rem] border border-border/40 bg-surface p-4 shadow-float ${className}`}
    >
      {children}
    </div>
  );
}
