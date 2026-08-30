import { AlertCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON_STROKE } from "@/lib/icons/constants";

type QueryErrorProps = {
  title?: string;
  body?: string;
  error?: unknown;
  onRetry: () => void;
  compact?: boolean;
};

export function QueryError({ title, body, error, onRetry, compact = false }: QueryErrorProps) {
  const { t } = useTranslation();
  const heading = title ?? t("common.errorTitle");
  const detail = error instanceof Error ? error.message : null;

  if (compact) {
    return (
      <div className="rounded-2xl border border-coral/30 bg-coral/5 px-4 py-4 text-center">
        <p className="text-sm font-bold text-coral">{heading}</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">{body ?? t("common.tryAgain")}</p>
        {detail && detail !== heading && (
          <p className="mx-auto mt-1 max-w-xs break-words text-[11px] text-muted-foreground" dir="ltr">
            {detail}
          </p>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2.5 text-xs font-bold text-navy-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={ICON_STROKE} />
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="py-12 text-center animate-rise">
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-2xl border border-border/70 bg-coral/10 text-coral">
        <AlertCircle className="h-9 w-9" strokeWidth={ICON_STROKE} aria-hidden="true" />
      </div>
      <div className="mt-4 text-base font-bold text-foreground">{heading}</div>
      <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted-foreground">{body ?? t("common.tryAgain")}</p>
      {detail && detail !== heading && (
        <p className="mx-auto mt-1 max-w-xs break-words text-[11px] text-muted-foreground" dir="ltr">
          {detail}
        </p>
      )}
      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring inline-flex items-center gap-1.5 rounded-2xl bg-navy px-4 py-3 text-sm font-bold text-navy-foreground"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={ICON_STROKE} />
          {t("common.retry")}
        </button>
      </div>
    </div>
  );
}
