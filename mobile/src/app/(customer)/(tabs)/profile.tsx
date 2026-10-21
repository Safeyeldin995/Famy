import { useState } from "react";
import { Page, QueryState, Row, ActionError } from "@/ui/Page";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Globe, LogOut } from "lucide-react-native";
import { reloadAppAsync } from "expo";
import { applyDirection, saveLanguage } from "@/lib/i18n";
import { useMyProfile } from "@/lib/queries";
import { signOutWithPushRevoke } from "@/lib/push";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

export default function Profile() {
  const { t, i18n } = useTranslation();
  const profile = useMyProfile();
  const [actionError, setActionError] = useState(false);

  const switchLanguage = async () => {
    const next = i18n.language === "en" ? "ar" : "en";
    await saveLanguage(next);
    await i18n.changeLanguage(next);
    // Layout direction only changes after a reload in React Native.
    if (applyDirection(next)) await reloadAppAsync();
  };

  return (
    <Page tab title={t("nav.profile")} queries={[profile]}>
      <QueryState query={profile}>
        <View style={styles.card}>
          <Text size="lg" weight="heavy">
            {profile.data?.full_name || t("greetings.there")}
          </Text>
        </View>
      </QueryState>
      <Row label={t("profile.favorites")} href="/favorites" />
      <Row
        label={t("profile.promoCodes")}
        detail={t("profile.promoCodesSub")}
        href="/promo-codes"
      />
      <Row label={t("profile.addresses")} href="/addresses" />
      <Row label={t("profile.family")} detail={t("profile.familySub")} href="/family-members" />
      <Row label={t("common.notifications")} href="/notifications" />
      <Row label={t("profile.help")} href="/help" />
      <Row
        label={t("profile.terms")}
        href={{ pathname: "/content/[key]", params: { key: "terms" } }}
      />
      <Row
        label={t("profile.privacy")}
        href={{ pathname: "/content/[key]", params: { key: "privacy" } }}
      />
      <ActionError error={actionError} />
      <View style={{ gap: space.md, marginTop: "auto" }}>
        <Button
          variant="secondary"
          label={`${t("profile.language")}: ${i18n.language === "en" ? t("common.english") : t("common.arabic")}`}
          icon={<Globe size={18} color={colors.foreground} />}
          onPress={() => {
            void switchLanguage().catch(() => setActionError(true));
          }}
        />
        <Button
          variant="secondary"
          label={t("profile.logout")}
          icon={<LogOut size={18} color={colors.destructive} />}
          onPress={async () => {
            const { error } = await signOutWithPushRevoke();
            if (error) {
              setActionError(true);
              return;
            }
            router.replace("/login");
          }}
        />
      </View>
      <Row label={t("accountDeletion.menuLabel")} href="/delete-account" />
    </Page>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, padding: space.xl, gap: space.lg },
  card: {
    padding: space.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
