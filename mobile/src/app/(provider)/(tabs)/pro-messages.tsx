import { View, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useConversations } from "@/lib/chatQueries";
import { ConversationRow } from "@/ui/chat/ConversationRow";
import { Page, QueryState, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { space } from "@/ui/theme";

export default function ProviderMessagesTab() {
  const { t } = useTranslation();
  const q = useConversations();
  const rows = q.data ?? [];
  return (
    <Page tab title={t("nav.messages")} queries={[q]}>
      <Text tone="muted">{t("messages.chatNotice")}</Text>
      <QueryState query={q}>
        {!rows.length ? (
          <View style={ui.card}>
            <Text weight="heavy">{t("messages.emptyTitle")}</Text>
            <Text tone="muted">{t("messages.emptyBody")}</Text>
          </View>
        ) : (
          <>
            <View testID="pro-conversation-list" style={styles.list}>
              {rows.map((item) => (
                <ConversationRow key={item.id} item={item} chatPath="/pro-chat/[id]" />
              ))}
            </View>
          </>
        )}
      </QueryState>
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md, paddingBottom: space.xxl },
});
