import { useTranslation } from "react-i18next";
import { MessageCircle } from "lucide-react-native";
import { useConversations } from "@/lib/chatQueries";
import { ConversationList } from "@/ui/chat/ConversationList";
import { Page, QueryState } from "@/ui/Page";
import { ConversationListSkeleton } from "@/ui/Skeleton";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { CustomerEmpty } from "@/ui/customer/Primitives";
import { space } from "@/ui/theme";

export default function CustomerMessages() {
  const { t } = useTranslation();
  const q = useConversations();
  const rows = q.data ?? [];
  const empty = (
    <CustomerEmpty
      Icon={MessageCircle}
      title={t("messages.emptyTitle")}
      body={t("messages.emptyBody")}
    />
  );

  return (
    <Page
      scroll={false}
      title={t("messages.title")}
      header={
        <CustomerPageHeader
          title={t("messages.title")}
          subtitle={t("messages.chatNotice")}
          backTo="/profile"
        />
      }
      contentStyle={{ padding: 0, paddingTop: space.sm, flex: 1 }}
    >
      {q.isError ? (
        <QueryState query={q} />
      ) : q.isLoading || q.isPending ? (
        <ConversationListSkeleton />
      ) : (
        <ConversationList
          items={rows}
          customer
          onRefresh={() => q.refetch()}
          ListEmptyComponent={empty}
        />
      )}
    </Page>
  );
}
