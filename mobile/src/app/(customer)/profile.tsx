import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Globe, LogOut } from "lucide-react-native";
import { reloadAppAsync } from "expo";
import { applyDirection, saveLanguage } from "@/lib/i18n";
import { useMyProfile } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

export default function Profile() {
  const { t, i18n } = useTranslation();
  const profile = useMyProfile();

  const switchLanguage = async () => {
    const next = i18n.language === "en" ? "ar" : "en";
    await saveLanguage(next);
    await i18n.changeLanguage(next);
    // Layout direction only changes after a reload in React Native.
    if (applyDirection(next)) await reloadAppAsync();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Text size="xxl" weight="heavy">
        {t("nav.profile")}
      </Text>
      <View style={styles.card}>
        <Text size="lg" weight="heavy">
          {profile.data?.full_name || t("greetings.there")}
        </Text>
      </View>
      <View style={{ gap: space.md, marginTop: "auto" }}>
        <Button
          variant="secondary"
          label={`${t("profile.language")}: ${i18n.language === "en" ? t("common.english") : t("common.arabic")}`}
          icon={<Globe size={18} color={colors.foreground} />}
          onPress={switchLanguage}
        />
        <Button
          variant="secondary"
          label={t("profile.logout")}
          icon={<LogOut size={18} color={colors.destructive} />}
          onPress={async () => {
            await supabase.auth.signOut();
            router.replace("/login");
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, padding: space.xl, gap: space.lg },
  card: { padding: space.xl, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
