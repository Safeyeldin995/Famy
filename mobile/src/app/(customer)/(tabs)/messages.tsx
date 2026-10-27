import { View, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { MessageCircle } from "lucide-react-native";
import { useConversations } from "@/lib/chatQueries";
import { ConversationRow } from "@/ui/chat/ConversationRow";
import { Page, QueryState, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { CustomerEmpty } from "@/ui/customer/Primitives";

export default function MessagesTab() {
  const { t } = useTranslation();
  const q = useConversations();
  const rows = q.data ?? [];
  return (
    <Page
      tab
      title={t("messages.title")}
      queries={[q]}
      header={
        <CustomerPageHeader title={t("messages.title")} subtitle={t("messages.chatNotice")} />
      }
      contentStyle={{ paddingTop: 8 }}
    >
      <QueryState query={q}>
        {!rows.length ? (
          <CustomerEmpty
            Icon={MessageCircle}
            title={t("messages.emptyTitle")}
            body={t("messages.emptyBody")}
          />
        ) : (
          <>
            <View testID="conversation-list" style={styles.list}>
              {rows.map((item) => (
                <ConversationRow key={item.id} item={item} customer />
              ))}
            </View>
          </>
        )}
      </QueryState>
    </Page>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    alignSelf: "center",
    backgroundColor: colors.brandTint,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: 999,
  },
  list: { gap: space.md, paddingBottom: space.xxl },
});
