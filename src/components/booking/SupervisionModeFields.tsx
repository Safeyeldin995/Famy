import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import {
  type SupervisionMode,
  SUPERVISION_MODES,
  supervisionModeOptionLabel,
} from "@/lib/booking/supervisionMode";
export function SupervisionModeFields({
  value,
  onChange,
}: {
  value: SupervisionMode | "";
  onChange: (mode: SupervisionMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h3 className="text-pro-16 font-extrabold">{t("bookFlow.supervision.title")}</h3>
      <p className="text-pro-13 text-muted-foreground">{t("bookFlow.supervision.intro")}</p>
      <div className="mt-3 space-y-2">
        {SUPERVISION_MODES.map((mode) => {
          const selected = value === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={selected}
              className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-start ${
                selected ? "border-brand bg-brand/8" : "border-border/60 bg-surface"
              }`}
              onClick={() => onChange(mode)}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  selected ? "border-brand bg-brand text-white" : "border-border"
                }`}
              >
                {selected && <Check size={12} />}
              </span>
              <span className="min-w-0 space-y-1">
                <span className="block text-pro-14 font-bold">
                  {supervisionModeOptionLabel(mode, t)}
                </span>
                <span className="block text-pro-12 text-muted-foreground">
                  {t(`bookFlow.supervision.${mode}.body`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
