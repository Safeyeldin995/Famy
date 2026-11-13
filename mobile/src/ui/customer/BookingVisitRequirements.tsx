import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { requiresSupervisionMode } from "@shared/booking/supervisionMode";
import { Text } from "@/ui/Text";
import { colors } from "@/ui/theme";

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
  const { t, i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const supervision = requiresSupervisionMode(categorySlug);
  const items = requirements
    .filter((row) => row.required_during_booking && row.fulfillment_mode !== "either")
    .map((row) => (ar ? row.name_ar : row.name_en) || row.name_en);
  if (!items.length && !supervision) return null;
  return (
    <View
      nativeID="booking-visit-requirements"
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        padding: 14,
        gap: 6,
      }}
    >
      <Text weight="heavy">{t("bookFlow.visitRequirementsTitle")}</Text>
      {supervision ? (
        <Text size="sm" tone="muted">
          • {t("bookFlow.visitRequirementSupervision")}
        </Text>
      ) : null}
      {items.map((item) => (
        <Text key={item} size="sm" tone="muted">
          • {item}
        </Text>
      ))}
    </View>
  );
}
