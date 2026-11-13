import { useTranslation } from "react-i18next";
import { MessageCircle } from "lucide-react-native";
import { useConversations } from "@/lib/chatQueries";
import { ConversationList } from "@/ui/chat/ConversationList";
import { Page, QueryState } from "@/ui/Page";
import { ConversationListSkeleton } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { ProviderHeader } from "@/ui/provider/ProviderHeader";
import { ProviderEmptyState } from "@/ui/ProviderEmptyState";
import { space } from "@/ui/theme";

export default function ProviderMessagesScreen() {
  const { t } = useTranslation();
  const q = useConversations();
  const rows = q.data ?? [];
  const empty = (
    <ProviderEmptyState
      icon={MessageCircle}
      title={t("messages.emptyTitle")}
      body={t("messages.emptyBody")}
    />
  );

  return (
    <Page
      scroll={false}
      title={t("nav.messages")}
      header={<ProviderHeader title={t("nav.messages")} />}
      contentStyle={{ padding: 0, flex: 1, gap: space.md }}
    >
      <Text tone="muted" style={{ paddingHorizontal: space.xl }}>
        {t("messages.chatNotice")}
      </Text>
      {q.isError ? (
        <QueryState query={q} />
      ) : q.isLoading || q.isPending ? (
        <ConversationListSkeleton />
      ) : (
        <ConversationList
          testID="pro-conversation-list"
          items={rows}
          customer={false}
          onRefresh={() => q.refetch()}
          ListEmptyComponent={empty}
        />
      )}
    </Page>
  );
}
