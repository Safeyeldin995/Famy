import type { ReactNode } from "react";
import { AdminCard } from "./AdminCard";
import { AdminQueryState } from "./AdminQueryState";

export function AdminSectionShell({
  title,
  count,
  isLoading,
  isError,
  error,
  onRetry,
  errorMessage,
  isEmpty,
  emptyTitle,
  children,
}: {
  title: string;
  count?: number;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  errorMessage?: string;
  isEmpty?: boolean;
  emptyTitle?: string;
  children: ReactNode | (() => ReactNode);
}) {
  return (
    <AdminCard>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold text-foreground">{title}</h2>
        {count !== undefined ? (
          <span className="rounded-md bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">
            {count}
          </span>
        ) : null}
      </div>
      <AdminQueryState
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
        errorMessage={errorMessage}
        isEmpty={isEmpty}
        emptyTitle={emptyTitle}
      >
        {children}
      </AdminQueryState>
    </AdminCard>
  );
}
