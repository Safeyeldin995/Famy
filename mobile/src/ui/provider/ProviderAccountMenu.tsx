import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Globe, LogOut, MoreHorizontal } from "lucide-react-native";
import { reloadAppAsync } from "expo";
import { applyDirection, saveLanguage } from "@/lib/i18n";
import { signOutWithPushRevoke } from "@/lib/push";
import { ActionError, Row } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, shadow, space } from "@/ui/theme";

export function ProviderAccountMenu() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [actionError, setActionError] = useState(false);

  const close = () => setOpen(false);

  const switchLanguage = async () => {
    const next = i18n.language === "en" ? "ar" : "en";
    await saveLanguage(next);
    await i18n.changeLanguage(next);
    if (applyDirection(next)) await reloadAppAsync();
    close();
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("pro.nav.profile")}
        onPress={() => setOpen(true)}
        style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      >
        <MoreHorizontal size={22} color={colors.foreground} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
            onPress={close}
          />
          <View
            accessibilityViewIsModal
            style={{
              backgroundColor: colors.surface,
              borderTopStartRadius: radius.xl,
              borderTopEndRadius: radius.xl,
              padding: space.xl,
              gap: space.sm,
              ...shadow.card,
            }}
          >
            <Text weight="heavy" size="lg">
              {t("pro.nav.profile")}
            </Text>
            <Row
              label={t("profile.help")}
              onPress={() => void (close(), router.push("/pro-help"))}
            />
            <Row
              label={t("profile.terms")}
              onPress={() =>
                void (close(),
                router.push({ pathname: "/content/[key]", params: { key: "terms" } }))
              }
            />
            <Row
              label={t("profile.privacy")}
              onPress={() =>
                void (close(),
                router.push({ pathname: "/content/[key]", params: { key: "privacy" } }))
              }
            />
            <Row
              label={t("accountDeletion.menuLabel")}
              onPress={() => void (close(), router.push("/pro-delete-account"))}
            />
            <Button
              variant="secondary"
              label={`${t("profile.language")}: ${i18n.language === "en" ? t("common.english") : t("common.arabic")}`}
              icon={<Globe size={18} color={colors.foreground} />}
              onPress={() => void switchLanguage().catch(() => setActionError(true))}
            />
            <Button
              variant="secondary"
              label={t("pro.profile.signOut")}
              icon={<LogOut size={18} color={colors.destructive} />}
              onPress={async () => {
                const { error } = await signOutWithPushRevoke();
                if (error) {
                  setActionError(true);
                  return;
                }
                close();
                router.replace("/login");
              }}
            />
            <ActionError error={actionError} />
            <Button variant="ghost" label={t("common.cancel")} onPress={close} />
          </View>
        </View>
      </Modal>
    </>
  );
}
