import { useState, useCallback, memo } from "react";
import { FlatList, RefreshControl, View, type ListRenderItem } from "react-native";
import type { ConversationListItem } from "@/lib/chatQueries";
import { ConversationRow } from "./ConversationRow";
import { colors, space } from "../theme";

function Separator() {
  return <View style={{ height: space.md }} />;
}

const RowCustomer = memo(function RowCustomer({ item }: { item: ConversationListItem }) {
  return <ConversationRow item={item} customer />;
});

const RowProvider = memo(function RowProvider({ item }: { item: ConversationListItem }) {
  return <ConversationRow item={item} chatPath="/pro-chat/[id]" customer={false} />;
});

export function ConversationList({
  items,
  customer,
  onRefresh,
  ListEmptyComponent,
  testID = "conversation-list",
}: {
  items: ConversationListItem[];
  customer: boolean;
  onRefresh: () => Promise<unknown>;
  ListEmptyComponent?: React.ReactElement | null;
  testID?: string;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const renderItem: ListRenderItem<ConversationListItem> = useCallback(
    ({ item }) => (customer ? <RowCustomer item={item} /> : <RowProvider item={item} />),
    [customer],
  );

  return (
    <FlatList
      testID={testID}
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ItemSeparatorComponent={Separator}
      contentContainerStyle={{
        paddingHorizontal: space.xl,
        paddingBottom: space.xxxl,
        flexGrow: 1,
        gap: 0,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.brand}
          colors={[colors.brand]}
          onRefresh={refresh}
        />
      }
      ListEmptyComponent={ListEmptyComponent ?? undefined}
    />
  );
}
