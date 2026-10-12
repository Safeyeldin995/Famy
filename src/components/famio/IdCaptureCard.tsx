import type { ReactNode } from "react";
import { Camera, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./providerApply.css";
export function IdCaptureCard({
  title,
  captured,
  onCapture,
  disabled,
  allowReplace = false,
  readOnly = false,
  actionLabel,
  accept = "image/*",
  status,
}: {
  title: string;
  captured: boolean;
  onCapture: (file: File) => void;
  disabled?: boolean;
  allowReplace?: boolean;
  readOnly?: boolean;
  actionLabel?: string;
  accept?: string;
  status?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={`apply-id ${captured ? "ok" : ""}`}>
      <span className="apply-id-art" aria-hidden="true" />
      <span className="apply-id-text">
        <b>{title}</b>
        {status ?? <small>{t(captured ? "providerApply.captured" : "providerApply.photoHint")}</small>}
      </span>
      {captured && !allowReplace ? (
        status ? null : <Check size={22} className="text-success" />
      ) : readOnly ? null : (
        <label className="apply-capture">
          <span>
            <Camera size={15} />
            {actionLabel ?? t("providerApply.capture")}
          </span>
          <input
            className="sr-only"
            aria-label={title}
            type="file"
            accept={accept}
            capture="environment"
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onCapture(file);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}
