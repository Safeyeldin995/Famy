import { Camera, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./providerApply.css";
export function IdCaptureCard({
  title,
  captured,
  onCapture,
  disabled,
}: {
  title: string;
  captured: boolean;
  onCapture: (file: File) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={`apply-id ${captured ? "ok" : ""}`}>
      <span className="apply-id-art" aria-hidden="true" />
      <span className="apply-id-text">
        <b>{title}</b>
        <small>{t(captured ? "providerApply.captured" : "providerApply.photoHint")}</small>
      </span>
      {captured ? (
        <Check size={22} className="text-success" />
      ) : (
        <label className="apply-capture">
          <span>
            <Camera size={15} />
            {t("providerApply.capture")}
          </span>
          <input
            className="sr-only"
            aria-label={title}
            type="file"
            accept="image/*"
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
