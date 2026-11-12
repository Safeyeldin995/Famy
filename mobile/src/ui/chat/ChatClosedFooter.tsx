import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

export function ChatClosedFooter({
  testID = "chat-closed-footer",
  supportPath = "/help",
}: {
  testID?: string;
  supportPath?: "/help";
}) {
  const { t } = useTranslation();
  return (
    <View testID={testID} style={styles.wrap}>
      <Text size="sm" tone="muted" style={styles.note}>
        {t("bookingChat.closedThreadNote")}
      </Text>
      <Button
        label={t("bookingChat.closedSupportCta")}
        variant="secondary"
        onPress={() => router.push(supportPath)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  note: { textAlign: "center" },
});
