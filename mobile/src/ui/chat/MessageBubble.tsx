import { View, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import type { BookingMessage } from "@/lib/chatQueries";
import { Avatar } from "@/ui/ProviderCard";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { formatChatMessageTime } from "./formatChatTime";

export function MessageBubble({
  message,
  mine,
  otherAvatar,
  otherName,
  customer = false,
}: {
  message: BookingMessage;
  mine: boolean;
  otherAvatar: string | null;
  otherName: string;
  customer?: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (message.message_type === "system") {
    return (
      <View style={styles.systemWrap}>
        <Text tone="muted" size="sm" style={styles.system}>
          {t(`bookingChat.system.${message.system_key}`, message.body)}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.row, mine ? styles.rowEnd : styles.rowStart]}>
      {!mine ? <Avatar raw={otherAvatar} size={28} round={customer} /> : null}
      <View
        style={[
          styles.bubble,
          mine ? styles.mine : styles.theirs,
          customer && {
            borderRadius: 20,
            paddingVertical: 10,
            ...(mine ? { borderBottomEndRadius: 6 } : { borderBottomStartRadius: 6 }),
          },
        ]}
      >
        <Text tone={mine ? "inverse" : "default"} style={styles.body}>
          {message.body}
        </Text>
        <Text
          tone={mine ? "inverse" : "muted"}
          size={customer ? "xs" : "sm"}
          style={[styles.time, customer && mine && { opacity: 0.7 }]}
        >
          {formatChatMessageTime(message.created_at, i18n.language)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: space.sm, marginVertical: space.xs },
  rowEnd: { justifyContent: "flex-end" },
  rowStart: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "78%",
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  mine: {
    backgroundColor: colors.brand,
    borderBottomEndRadius: radius.sm,
  },
  theirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomStartRadius: radius.sm,
  },
  body: { writingDirection: "auto" },
  time: { marginTop: space.xs, writingDirection: "ltr" },
  systemWrap: { alignItems: "center", paddingVertical: space.sm },
  system: {
    backgroundColor: colors.surface2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    textAlign: "center",
  },
});
