import { useTranslation } from "react-i18next";
import {
  applyChecklistStatusLabelKey,
  type ApplyDocumentChecklistItem,
} from "@/lib/provider/applyDocumentChecklist";

export function ApplyDocumentChecklist({ items }: { items: ApplyDocumentChecklistItem[] }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <section className="apply-doc-checklist" aria-label={t("providerApply.checklistTitle")}>
      <h2 className="apply-label">{t("providerApply.checklistTitle")}</h2>
      <ul className="apply-doc-checklist-list">
        {items.map((item) => {
          const label = item.labelKey ? t(item.labelKey) : item.label ?? "";
          const statusLabel = t(applyChecklistStatusLabelKey(item.status));
          return (
            <li
              key={item.key}
              className={item.highlight ? "apply-doc-checklist-row highlight" : "apply-doc-checklist-row"}
            >
              <span className="apply-doc-checklist-name">{label}</span>
              <span className="apply-doc-checklist-status">{statusLabel}</span>
              {item.highlight && item.reason ? (
                <p className="apply-doc-checklist-reason text-pro-12 text-coral">{item.reason}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
