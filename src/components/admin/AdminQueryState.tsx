import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AdminQueryError } from "./AdminQueryError";
import { AdminEmptyState } from "./AdminEmptyState";

export function AdminQueryState({
  isLoading,
  isError,
  error,
  onRetry,
  errorMessage,
  isEmpty,
  emptyTitle,
  emptyBody,
  skeletonCount = 3,
  children,
}: {
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  errorMessage?: string;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  skeletonCount?: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (isError && onRetry) {
    return (
      <AdminQueryError
        message={errorMessage ?? t("common.errorTitle", "Something went wrong")}
        error={error}
        onRetry={onRetry}
      />
    );
  }

  if (isEmpty) {
    return <AdminEmptyState title={emptyTitle ?? t("common.noResults", "No results")} body={emptyBody} />;
  }

  return <>{children}</>;
}
