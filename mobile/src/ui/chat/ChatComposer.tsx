import { StyleSheet, View, TextInput, Pressable, ActivityIndicator } from "react-native";
import { Send } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { bodyTextInputProps } from "@/ui/a11y";
import { Text } from "@/ui/Text";
import { useInputFont } from "@/ui/auth/useInputFont";
import { colors, fontSize, radius, space } from "@/ui/theme";

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  pending,
  warning,
  onClearWarning,
  multiline = true,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onSend: (body: string) => void;
  pending: boolean;
  warning: string | null;
  onClearWarning: () => void;
  multiline?: boolean;
}) {
  const { t } = useTranslation();
  const family = useInputFont("regular");
  const trimmed = value.trim();
  const submit = () => {
    if (!trimmed || pending) return;
    onSend(trimmed);
    onChangeText("");
  };
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
          {...bodyTextInputProps()}
          accessibilityLabel={t("messages.placeholder")}
          value={value}
          onChangeText={(next) => {
            onChangeText(next);
            if (warning) onClearWarning();
          }}
          placeholder={t("messages.placeholder")}
          placeholderTextColor={colors.muted}
          style={[styles.input, multiline ? styles.inputMultiline : styles.inputSingle, { fontFamily: family }]}
          multiline={multiline}
          maxLength={2000}
          onSubmitEditing={multiline ? undefined : submit}
        />
        <Pressable
          testID="chat-send"
          accessibilityRole="button"
          accessibilityLabel={t("messages.send")}
          disabled={!trimmed || pending}
          onPress={submit}
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
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    paddingHorizontal: space.lg,
    fontSize: fontSize.md,
    color: colors.foreground,
    textAlign: "auto",
  },
  inputMultiline: {
    minHeight: 44,
    maxHeight: 120,
    paddingVertical: space.sm,
  },
  inputSingle: {
    height: 48,
    borderRadius: radius.xl,
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
