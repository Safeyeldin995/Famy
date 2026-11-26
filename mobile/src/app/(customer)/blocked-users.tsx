import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { colors, radius, space } from "@/ui/theme";
import { useMyChatBlocks, useUnblockChatConversation } from "@/lib/ugcQueries";

export default function BlockedUsersScreen() {
  const { t } = useTranslation();
  const blocks = useMyChatBlocks();
  const unblock = useUnblockChatConversation();

  const confirmUnblock = (conversationId: string, name: string) => {
    Alert.alert(t("ugc.unblockTitle"), t("ugc.unblockBody", { name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("ugc.unblockConfirm"),
        style: "destructive",
        onPress: () => {
          unblock.mutate(conversationId, {
            onSuccess: () => {
              void blocks.refetch();
            },
            onError: () => Alert.alert(t("common.error"), t("ugc.unblockError")),
          });
        },
      },
    ]);
  };

  return (
    <Page title={t("ugc.blockedUsersTitle")} queries={[blocks]}>
      <Text tone="muted">{t("ugc.blockedUsersSubtitle")}</Text>
      <QueryState query={blocks} empty={!blocks.data?.length} emptyKey="ugc.blockedUsersEmpty">
        <View style={styles.list}>
          {blocks.data?.map((row) => (
            <View key={row.id} style={styles.row}>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text weight="heavy">{row.other_full_name || t("ugc.blockedUnknownUser")}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("ugc.unblockA11y", {
                  name: row.other_full_name || t("ugc.blockedUnknownUser"),
                })}
                onPress={() => {
                  if (!row.conversation_id) {
                    Alert.alert(t("common.error"), t("ugc.unblockNoConversation"));
                    return;
                  }
                  confirmUnblock(row.conversation_id, row.other_full_name || "");
                }}
                style={styles.unblock}
                disabled={unblock.isPending}
              >
                <Text weight="bold" tone="brand">
                  {t("ugc.unblockConfirm")}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      </QueryState>
      {unblock.isPending ? (
        <Button label={t("common.loading")} loading disabled style={{ marginTop: space.md }} />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md, marginTop: space.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  unblock: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm },
});