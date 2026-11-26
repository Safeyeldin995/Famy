import { useState } from "react";
import { Alert, Modal, Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { MoreVertical } from "lucide-react-native";
import { router } from "expo-router";
import { useBlockChatConversation } from "@/lib/ugcQueries";
import { UgcReportSheet } from "./UgcReportSheet";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

export function ChatThreadSafetyMenu({
  conversationId,
  afterBlockTo,
}: {
  conversationId: string;
  afterBlockTo: "/messages" | "/pro-messages";
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const block = useBlockChatConversation();

  const confirmBlock = () => {
    setMenuOpen(false);
    Alert.alert(t("ugc.blockTitle"), t("ugc.blockBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("ugc.blockConfirm"),
        style: "destructive",
        onPress: () => {
          block.mutate(conversationId, {
            onSuccess: () => {
              Alert.alert(t("ugc.blockDoneTitle"), t("ugc.blockDoneBody"), [
                { text: t("common.ok"), onPress: () => router.replace(afterBlockTo) },
              ]);
            },
            onError: () => Alert.alert(t("common.somethingWentWrong")),
          });
        },
      },
    ]);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("ugc.chatActions")}
        onPress={() => setMenuOpen(true)}
        style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      >
        <MoreVertical size={22} color={colors.foreground} />
      </Pressable>
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" }}
          onPress={() => setMenuOpen(false)}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              padding: space.lg,
              gap: space.xs,
              borderTopStartRadius: 16,
              borderTopEndRadius: 16,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("ugc.reportThread")}
              onPress={() => {
                setMenuOpen(false);
                setReportOpen(true);
              }}
              style={{ paddingVertical: space.md }}
            >
              <Text weight="bold">{t("ugc.reportThread")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("ugc.blockUser")}
              onPress={confirmBlock}
              style={{ paddingVertical: space.md }}
            >
              <Text weight="bold" tone="danger">
                {t("ugc.blockUser")}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      <UgcReportSheet
        visible={reportOpen}
        subjectType="chat_thread"
        conversationId={conversationId}
        onClose={() => setReportOpen(false)}
      />
    </>
  );
}