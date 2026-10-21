import { useState } from "react";
import { View, TextInput, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Send } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Text } from "@/ui/Text";
import { colors, fonts, radius, space } from "@/ui/theme";

export function ChatComposer({
  onSend,
  pending,
  warning,
  onClearWarning,
}: {
  onSend: (body: string) => void;
  pending: boolean;
  warning: string | null;
  onClearWarning: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const family = (i18n.language === "en" ? fonts.en : fonts.ar).regular;
  const trimmed = text.trim();
  return (
    <View style={styles.wrap}>
      {warning ? (
        <View style={styles.warning}>
          <Text size="sm">{warning}</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <TextInput
          testID="chat-input"
          value={text}
          onChangeText={(value) => {
            setText(value);
            if (warning) onClearWarning();
          }}
          placeholder={t("messages.placeholder")}
          placeholderTextColor={colors.muted}
          style={[styles.input, { fontFamily: family }]}
          multiline
          maxLength={2000}
        />
        <Pressable
          testID="chat-send"
          accessibilityRole="button"
          accessibilityLabel={t("messages.send")}
          disabled={!trimmed || pending}
          onPress={() => {
            if (!trimmed || pending) return;
            onSend(trimmed);
            setText("");
          }}
          style={({ pressed }) => [
            styles.send,
            (!trimmed || pending) && styles.sendDisabled,
            pressed && trimmed && !pending && styles.sendPressed,
          ]}
        >
          {pending ? (
            <ActivityIndicator color={colors.brandForeground} />
          ) : (
            <Send color={colors.brandForeground} size={20} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  warning: {
    backgroundColor: "#FEF3C7",
    borderRadius: radius.lg,
    padding: space.md,
    marginBottom: space.sm,
  },
  row: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    fontSize: 16,
    color: colors.foreground,
    textAlign: "auto",
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  sendPressed: { transform: [{ scale: 0.96 }] },
});
