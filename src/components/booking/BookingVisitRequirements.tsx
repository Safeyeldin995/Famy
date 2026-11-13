import { useTranslation } from "react-i18next";
import { currentLang } from "@/lib/i18n";
import { requiresSupervisionMode } from "@/lib/booking/supervisionMode";

type RequirementRow = {
  id: string;
  name_ar: string;
  name_en: string;
  required_during_booking?: boolean | null;
  fulfillment_mode?: string | null;
};

export function BookingVisitRequirements({
  categorySlug,
  requirements,
}: {
  categorySlug?: string | null;
  requirements: RequirementRow[];
}) {
  const { t } = useTranslation();
  const ar = currentLang() === "ar";
  const supervision = requiresSupervisionMode(categorySlug);
  const items = requirements
  .filter((row) => row.required_during_booking && row.fulfillment_mode !== "either")
    .map((row) => (ar ? row.name_ar : row.name_en) || row.name_en);
  if (!items.length && !supervision) return null;
  return (
    <div
      id="booking-visit-requirements"
      className="rounded-2xl border border-border/60 bg-surface-2/70 p-3.5 text-pro-13"
    >
      <p className="font-extrabold text-foreground">{t("bookFlow.visitRequirementsTitle")}</p>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-muted-foreground marker:text-brand">
        {supervision ? <li>{t("bookFlow.visitRequirementSupervision")}</li> : null}
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
