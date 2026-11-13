import { useTranslation } from "react-i18next";
import { View } from "react-native";
import {
  applyChecklistStatusLabelKey,
  type ApplyDocumentChecklistItem,
} from "@shared/provider/applyDocumentChecklist";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

export function ApplyDocumentChecklist({ items }: { items: ApplyDocumentChecklistItem[] }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <View style={{ gap: space.sm, marginBottom: space.md }} accessibilityRole="summary">
      <Text weight="heavy">{t("providerApply.checklistTitle")}</Text>
      {items.map((item) => {
        const label = item.labelKey ? t(item.labelKey) : item.label ?? "";
        const statusLabel = t(applyChecklistStatusLabelKey(item.status));
        return (
          <View
            key={item.key}
            style={{
              borderWidth: 1,
              borderColor: item.highlight ? colors.destructive : colors.border,
              borderRadius: 12,
              padding: space.md,
              gap: space.xs,
              backgroundColor: item.highlight ? colors.surface2 : colors.surface,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
              <Text style={{ flex: 1 }}>{label}</Text>
              <Text size="xs" tone="muted">
                {statusLabel}
              </Text>
            </View>
            {item.highlight && item.reason ? (
              <Text size="sm" tone="danger">
                {item.reason}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
