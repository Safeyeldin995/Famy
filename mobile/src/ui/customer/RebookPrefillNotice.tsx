import { useTranslation } from "react-i18next";
import { View } from "react-native";
import type { RebookPrefillNotice } from "@shared/booking/rebookPrefill";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

export function RebookPrefillNoticeList({ notices }: { notices: RebookPrefillNotice[] }) {
  const { t } = useTranslation();
  if (!notices.length) return null;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.warning,
        backgroundColor: colors.surface2,
        borderRadius: 16,
        padding: space.md,
        gap: space.xs,
        marginBottom: space.md,
      }}
      accessibilityRole="summary"
    >
      <Text weight="heavy">{t("bookFlow.rebookPrefillTitle")}</Text>
      {notices.map((notice, index) => (
        <Text key={`${notice.code}-${notice.requirementId ?? index}`} size="sm" tone="muted">
          • {t(`bookFlow.rebookDropped.${notice.code}`)}
        </Text>
      ))}
    </View>
  );
}
