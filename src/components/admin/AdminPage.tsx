import type { ReactNode } from "react";
import { AdminPageHeader } from "./AdminPageHeader";

export function AdminPage({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-4 px-4 py-5 sm:px-6 ${className}`}>
      {title ? <AdminPageHeader title={title} subtitle={subtitle} actions={actions} /> : null}
      {children}
    </div>
  );
}
