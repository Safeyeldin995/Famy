import type { ReactNode } from "react";

export function HomeSection({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-8 ${className}`}>
      <div className="mb-4 flex items-end justify-between gap-3 px-5">
        <div className="min-w-0">
          {subtitle ? <p className="text-overline">{subtitle}</p> : null}
          <h2 className={`text-title text-foreground ${subtitle ? "mt-1" : ""}`}>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
