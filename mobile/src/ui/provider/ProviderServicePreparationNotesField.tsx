import {
  normalizePreparationNotes,
  PREPARATION_NOTES_MAX_LENGTH,
} from "@shared/provider/preparationNotes";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Field } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

type Props = {
  savedNotes: string | null | undefined;
  draft: string;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  savePending: boolean;
};

export function ProviderServicePreparationNotesField({
  savedNotes,
  draft,
  onDraftChange,
  onSave,
  savePending,
}: Props) {
  const { t } = useTranslation();
  const normalizedDraft = normalizePreparationNotes(draft) ?? "";
  const normalizedSaved = normalizePreparationNotes(savedNotes) ?? "";
  const dirty = normalizedDraft !== normalizedSaved;
  const overLimit = draft.length > PREPARATION_NOTES_MAX_LENGTH;

  return (
    <View style={{ marginTop: 12, gap: 8 }}>
      <Field
        label={t("pro.profile.preparationNotesLabel")}
        value={draft}
        onChangeText={onDraftChange}
        multiline
        placeholder={t("pro.profile.preparationNotesPlaceholder")}
      />
      <Text tone="muted" size="sm">
        {t("pro.profile.preparationNotesCounter", {
          count: Math.min(draft.length, PREPARATION_NOTES_MAX_LENGTH),
          max: PREPARATION_NOTES_MAX_LENGTH,
        })}
      </Text>
      {dirty ? (
        <Button
          variant="secondary"
          label={t("common.save")}
          loading={savePending}
          disabled={overLimit}
          onPress={onSave}
        />
      ) : null}
    </View>
  );
}
