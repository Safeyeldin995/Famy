import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Send, ShieldCheck } from "lucide-react-native";
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
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { MessageBubble } from "@/ui/chat/MessageBubble";
import { Button } from "@/ui/Button";
import { ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { colors, fonts, space } from "@/ui/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList>(null);
  const [draft, setDraft] = useState("");
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
    if (!body.trim() || send.isPending) return;
    if (containsContactInfo(body)) {
      setWarning(t("bookingChat.contactBlocked", CONTACT_BLOCKED_MESSAGE));
      return;
    }
    send.mutate(body, {
      onSuccess: () => {
        setWarning(null);
        setDraft("");
      },
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
      style={[styles.flex, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <CustomerPageHeader
        title={otherName}
        subtitle={t("messages.chatNotice")}
        backTo="/messages"
        right={<Avatar raw={otherAvatar} size={44} round />}
      />
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
          <FlatList
            ref={list}
            testID="chat-thread"
            style={{ backgroundColor: colors.surface2 }}
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
            ListHeaderComponent={
              <View style={styles.notice}>
                <ShieldCheck size={12} color={colors.success} />
                <Text size="xs">{t("messages.stayInApp")}</Text>
              </View>
            }
            data={msgs.data ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.thread}
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                mine={!!meId && item.sender_id === meId}
                otherAvatar={otherAvatar}
                otherName={otherName}
                customer
              />
            )}
            ListEmptyComponent={
              <View style={styles.emptyThread}>
                <Text tone="muted">{t("bookingChat.emptyTitle")}</Text>
              </View>
            }
          />
          {warning ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#FFFBEB" }}>
              <Text size="xs" accessibilityRole="alert">
                {warning}
              </Text>
            </View>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 8,
              paddingHorizontal: 12,
              paddingTop: 10,
              paddingBottom: 12,
              backgroundColor: colors.surface,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <TextInput
              testID="chat-input"
              accessibilityLabel={t("messages.placeholder")}
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                setWarning(null);
              }}
              placeholder={t("messages.placeholder")}
              placeholderTextColor={colors.muted}
              maxLength={2000}
              onSubmitEditing={() => handleSend(draft.trim())}
              style={{
                flex: 1,
                height: 48,
                borderRadius: 24,
                backgroundColor: colors.surface2,
                paddingHorizontal: 16,
                fontSize: 14,
                color: colors.foreground,
                fontFamily: (i18n.language === "ar" ? fonts.ar : fonts.en).regular,
                textAlign: "auto",
              }}
            />
            <Pressable
              testID="chat-send"
              accessibilityRole="button"
              accessibilityLabel={t("messages.send")}
              disabled={!draft.trim() || send.isPending}
              onPress={() => handleSend(draft.trim())}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: colors.brand,
                alignItems: "center",
                justifyContent: "center",
                opacity: !draft.trim() || send.isPending ? 0.4 : 1,
              }}
            >
              <Send size={16} color={colors.surface} />
            </Pressable>
          </View>
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
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginVertical: 12,
    alignSelf: "center",
    borderRadius: 999,
    backgroundColor: "#D9F5E780",
  },
  thread: { paddingHorizontal: space.md, paddingVertical: space.lg, gap: space.xs },
  emptyThread: { alignItems: "center", paddingVertical: space.xxl },
});
