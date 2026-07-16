import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

type AdminQueryErrorProps = {
  message: string;
  error?: unknown;
  onRetry: () => void;
  compact?: boolean;
};

export function AdminQueryError({ message, error, onRetry, compact = false }: AdminQueryErrorProps) {
  const { t } = useTranslation();
  const detail = error instanceof Error ? error.message : null;

  return (
    <div className={`rounded-xl border border-coral/30 bg-coral/5 text-coral ${compact ? "p-2 text-xs" : "p-3 text-sm"}`}>
      <p className="font-semibold">{message}</p>
      {detail && detail !== message && <p className="mt-1 break-words text-[11px]" dir="ltr">{detail}</p>}
      <button
        type="button"
        onClick={onRetry}
        className="focus-ring mt-2 inline-flex items-center gap-1 rounded-lg border border-coral/40 px-2.5 py-1 text-xs font-bold"
      >
        <RefreshCw className="h-3 w-3" />
        {t("common.retry")}
      </button>
    </div>
  );
}
