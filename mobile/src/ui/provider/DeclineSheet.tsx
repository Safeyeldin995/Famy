import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useCancelBooking, useCancellationReasons } from "@/lib/provider/cancellation";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, fonts, radius, space } from "@/ui/theme";
import { bodyTextInputProps } from "../a11y";

function cancelErrorMessage(error: unknown, t: (key: string) => string) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  if (message.trim()) return message.trim();
  return t("common.somethingWentWrong");
}

export function DeclineSheet({
  bookingId,
  visible,
  onClose,
  title,
}: {
  bookingId: string;
  visible: boolean;
  onClose: () => void;
  title: string;
}) {
  const { t, i18n } = useTranslation();
  const reasons = useCancellationReasons("provider");
  const cancel = useCancelBooking();
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const ar = i18n.language.startsWith("ar");
  const inputFont = (ar ? fonts.ar : fonts.en).bold;
  const selected = reasons.data?.find((r) => r.id === reasonId);
  const needsNote = selected?.requires_note;

  useEffect(() => {
    if (!visible) {
      setReasonId(null);
      setNote("");
      cancel.reset();
    }
  }, [cancel, visible]);

  const confirm = () => {
    if (!reasonId || (needsNote && !note.trim()) || cancel.isPending) return;
    cancel.mutate(
      { bookingId, reasonId, note: note.trim() || undefined },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("pro.booking.keep")}
        style={styles.backdrop}
        onPress={onClose}
      />
      <View style={styles.sheet}>
        <Text size="lg" weight="heavy">
          {title}
        </Text>
        <Text tone="muted" size="sm">
          {t("pro.booking.irreversible")}
        </Text>
        {reasons.isLoading ? (
          <View style={{ minHeight: 120, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : null}
        {reasons.isError ? (
          <View style={{ gap: space.sm }}>
            <Text tone="danger">{t("common.somethingWentWrong")}</Text>
            <Button
              variant="secondary"
              label={t("onlineSession.retry")}
              onPress={() => void reasons.refetch()}
            />
          </View>
        ) : null}
        {!reasons.isLoading && !reasons.isError ? (
          <ScrollView style={{ maxHeight: 280 }}>
            {reasons.data?.map((r) => (
              <Pressable
                key={r.id}
                accessibilityRole="radio"
                accessibilityLabel={ar ? r.name_ar : r.name_en}
                accessibilityState={{ checked: reasonId === r.id }}
                onPress={() => setReasonId(r.id)}
                style={[styles.reason, reasonId === r.id && styles.reasonOn]}
              >
                <Text weight="bold">{ar ? r.name_ar : r.name_en}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {needsNote ? (
          <TextInput
            {...bodyTextInputProps()}
            value={note}
            onChangeText={setNote}
            placeholder={t("pro.booking.reasonPlaceholder")}
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.note, { fontFamily: inputFont }]}
          />
        ) : null}
        {cancel.isError ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {cancelErrorMessage(cancel.error, t)}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button
            variant="secondary"
            label={t("pro.booking.keep")}
            onPress={onClose}
            style={{ flex: 1 }}
          />
          <Button
            label={t("pro.booking.confirm")}
            loading={cancel.isPending}
            disabled={!reasonId || (needsNote && !note.trim()) || reasons.isLoading || reasons.isError}
            onPress={confirm}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopStartRadius: radius.xl,
    borderTopEndRadius: radius.xl,
    padding: space.lg,
    gap: space.md,
  },
  reason: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.xs,
  },
  reasonOn: { borderColor: colors.brand, backgroundColor: colors.surface2 },
  note: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    textAlignVertical: "top",
    color: colors.foreground,
  },
});