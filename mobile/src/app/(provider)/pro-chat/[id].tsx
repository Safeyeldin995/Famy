import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react-native";
import {
  CONTACT_BLOCKED_MESSAGE,
  containsContactInfo,
  useConversation,
  useMarkBookingMessagesRead,
  useMessages,
  useSendMessage,
} from "@/lib/chatQueries";
import { useSession } from "@/lib/session";
import { Avatar } from "@/ui/ProviderCard";
import { ChatComposer } from "@/ui/chat/ChatComposer";
import { MessageBubble } from "@/ui/chat/MessageBubble";
import { Button } from "@/ui/Button";
import { ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

export default function ProviderChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { session } = useSession();
  const meId = session?.user.id ?? null;
  const conv = useConversation(id);
  const msgs = useMessages(id);
  const send = useSendMessage(id);
  const markRead = useMarkBookingMessagesRead();
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    const bookingId = conv.data?.booking_id;
    if (bookingId && (msgs.data?.length ?? 0) > 0) markRead.mutate(bookingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mark read when thread loads
  }, [conv.data?.booking_id, msgs.data?.length]);

  const otherName = conv.data?.other?.full_name || t("profile.famioUser");
  const otherAvatar = conv.data?.other?.avatar_url ?? null;

  const handleSend = (body: string) => {
    if (containsContactInfo(body)) {
      setWarning(t("bookingChat.contactBlocked", CONTACT_BLOCKED_MESSAGE));
      return;
    }
    send.mutate(body, {
      onSuccess: () => setWarning(null),
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "contact_masked")
          setWarning(t("bookingChat.contactBlocked", CONTACT_BLOCKED_MESSAGE));
        else setWarning(t("messages.sendFailed"));
      },
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <Stack.Screen options={{ title: otherName }} />
      {conv.isLoading || msgs.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
          <Text tone="muted">{t("common.loading")}</Text>
        </View>
      ) : conv.isError || msgs.isError ? (
        <View style={ui.card}>
          <Text tone="danger">{t("common.somethingWentWrong")}</Text>
          <Button
            label={t("common.retry")}
            variant="secondary"
            onPress={() => {
              if (conv.isError) void conv.refetch();
              if (msgs.isError) void msgs.refetch();
            }}
          />
        </View>
      ) : !conv.data ? (
        <View style={ui.card}>
          <Text weight="heavy">{t("customerChat.unavailable")}</Text>
          <Text tone="muted">{t("bookingChat.unavailableBody")}</Text>
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <Avatar raw={otherAvatar} size={44} />
            <View style={styles.headerText}>
              <Text weight="heavy" size="lg">
                {otherName}
              </Text>
              <Text tone="muted" size="sm">
                {t("messages.chatNotice")}
              </Text>
            </View>
          </View>
          <View style={styles.notice}>
            <ShieldCheck size={14} color={colors.success} />
            <Text size="sm">{t("messages.stayInApp")}</Text>
          </View>
          <FlatList
            testID="pro-chat-thread"
            inverted
            data={msgs.data ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.thread}
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                mine={!!meId && item.sender_id === meId}
                otherAvatar={otherAvatar}
                otherName={otherName}
              />
            )}
            ListEmptyComponent={
              <View style={styles.emptyThread}>
                <Text tone="muted">{t("bookingChat.emptyTitle")}</Text>
              </View>
            }
          />
          <ChatComposer
            onSend={handleSend}
            pending={send.isPending}
            warning={warning}
            onClearWarning={() => setWarning(null)}
          />
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerText: { flex: 1, gap: space.xs },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    paddingVertical: space.sm,
    backgroundColor: colors.surface2,
  },
  thread: { paddingHorizontal: space.md, paddingVertical: space.lg, gap: space.xs },
  emptyThread: { alignItems: "center", paddingVertical: space.xxl },
});
