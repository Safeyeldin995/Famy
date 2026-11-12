import { preparationNotesForDisplay } from "@shared/provider/preparationNotes";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Text } from "@/ui/Text";
import { ui } from "@/ui/Page";

type Props = {
  notes: string | null | undefined;
};

export function CustomerPreparationNotesSection({ notes }: Props) {
  const { t } = useTranslation();
  const text = preparationNotesForDisplay(notes);
  if (!text) return null;
  return (
    <View style={[ui.card, { marginTop: 12, gap: 8 }]}>
      <Text size="sm" weight="bold" tone="muted">
        {t("customerPreparation.sectionTitle")}
      </Text>
      <Text style={{ lineHeight: 22 }}>{text}</Text>
    </View>
  );
}
