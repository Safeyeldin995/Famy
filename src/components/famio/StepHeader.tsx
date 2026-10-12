import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./providerApply.css";
export function StepHeader({ step, onBack, total = 3 }: { step: number; onBack?: () => void; total?: number }) {
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
            <ChevronLeft size={20} />
          </button>
        ) : (
          <span />
        )}
        <span className="apply-step">{total === 3 ? t("providerApply.step", { step }) : t("customerBooking.step", { step, total })}</span>
      </div>
      <div className="apply-segments" style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }} aria-hidden="true">
        {Array.from({ length: total }, (_, index) => index + 1).map((n) => (
          <span key={n} className={n <= step ? "on" : ""} />
        ))}
      </div>
    </header>
  );
}
