import { View, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { MessageCircle } from "lucide-react-native";
import { useConversations } from "@/lib/chatQueries";
import { ConversationRow } from "@/ui/chat/ConversationRow";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { ProviderHeader } from "@/ui/provider/ProviderHeader";
import { ProviderEmptyState } from "@/ui/ProviderEmptyState";
import { space } from "@/ui/theme";

export default function ProviderMessagesScreen() {
  const { t } = useTranslation();
  const q = useConversations();
  const rows = q.data ?? [];
  return (
    <Page
      title={t("nav.messages")}
      header={<ProviderHeader title={t("nav.messages")} />}
      queries={[q]}
    >
      <Text tone="muted">{t("messages.chatNotice")}</Text>
      <QueryState query={q}>
        {!rows.length ? (
          <ProviderEmptyState
            icon={MessageCircle}
            title={t("messages.emptyTitle")}
            body={t("messages.emptyBody")}
          />
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
