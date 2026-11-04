import { View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  SUPERVISION_MODES,
  type SupervisionMode,
  supervisionModeOptionLabel,
} from "@shared/booking/supervisionMode";
import { Text } from "@/ui/Text";
import { Choices } from "@/ui/Page";

export function SupervisionModeChoices({
  value,
  onChange,
}: {
  value: SupervisionMode | "";
  onChange: (mode: SupervisionMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 12 }}>
      <Text weight="bold">{t("bookFlow.supervision.title")}</Text>
      <Text tone="muted" size="sm">
        {t("bookFlow.supervision.intro")}
      </Text>
      <Choices
        layout="cards"
        label={t("bookFlow.supervision.title")}
        value={value}
        onChange={(v) => onChange(v as SupervisionMode)}
        options={SUPERVISION_MODES.map((mode) => ({
          value: mode,
          label: `${supervisionModeOptionLabel(mode, t)}\n${t(`bookFlow.supervision.${mode}.body`)}`,
        }))}
      />
    </View>
  );
}
