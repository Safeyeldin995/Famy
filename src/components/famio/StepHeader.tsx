import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./providerApply.css";
export function StepHeader({ step, onBack }: { step: number; onBack?: () => void }) {
  const { t } = useTranslation();
  return (
    <header className="apply-header">
      <div className="apply-nav">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="apply-back"
            aria-label={t("common.back")}
          >
            <ChevronRight size={20} />
          </button>
        ) : (
          <span />
        )}
        <span className="apply-step">{t("providerApply.step", { step })}</span>
      </div>
      <div className="apply-segments" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= step ? "on" : ""} />
        ))}
      </div>
    </header>
  );
}
