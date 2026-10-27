import { Pressable, View, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import type { ConversationListItem } from "@/lib/chatQueries";
import { Avatar } from "@/ui/ProviderCard";
import { Text } from "@/ui/Text";
import { colors, radius, shadow, space } from "@/ui/theme";
import { formatChatListTime } from "./formatChatTime";

export function ConversationRow({
  item,
  chatPath = "/chat/[id]",
  customer = false,
}: {
  item: ConversationListItem;
  chatPath?: "/chat/[id]" | "/pro-chat/[id]";
  customer?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const name = item.other_name || t("profile.famioUser");
  const preview = item.last_system_key
    ? t(`bookingChat.system.${item.last_system_key}`, item.last_message ?? "")
    : (item.last_message ?? t("messages.sayHello"));
  return (
    <Pressable
      testID={`conversation-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${preview}`}
      onPress={() => router.push({ pathname: chatPath, params: { id: item.id } })}
      style={({ pressed }) => [
        styles.row,
        customer && { borderRadius: 16, padding: 14, gap: 14 },
        pressed && styles.pressed,
      ]}
    >
      <Avatar raw={item.other_avatar} size={56} round={customer} />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text weight="heavy" size="lg" numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          <Text tone="muted" size={customer ? "xs" : "sm"} weight="bold" style={styles.time}>
            {formatChatListTime(item.last_time, i18n.language)}
          </Text>
        </View>
        <View style={styles.bottom}>
          <Text tone="muted" numberOfLines={1} style={styles.preview}>
            {preview}
          </Text>
          {item.unread ? <View testID="conversation-unread" style={styles.dot} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 44,
    ...shadow.card,
  },
  pressed: { opacity: 0.92 },
  body: { flex: 1, minWidth: 0, gap: space.xs },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { flex: 1 },
  time: { flexShrink: 0 },
  bottom: { flexDirection: "row", alignItems: "center", gap: space.sm },
  preview: { flex: 1 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
});
