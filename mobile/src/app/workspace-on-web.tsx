import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { Briefcase } from "lucide-react-native";
import { appConfig, supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

/**
 * Providers and admins land here until their screens ship in the app.
 * The admin dashboard stays on the web by design.
 */
export default function WorkspaceOnWeb() {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <View style={styles.icon}>
          <Briefcase size={28} color={colors.brand} />
        </View>
        <Text size="xxl" weight="heavy" style={{ textAlign: "center" }}>
          {t("mobile.workspaceOnWebTitle")}
        </Text>
        <Text tone="muted" style={{ textAlign: "center" }}>
          {t("mobile.workspaceOnWebBody")}
        </Text>
        <Button
          label={t("mobile.openOnWeb")}
          onPress={() => WebBrowser.openBrowserAsync(appConfig.webOrigin)}
          style={{ alignSelf: "stretch" }}
        />
        <Button
          variant="ghost"
          label={t("profile.logout")}
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
  safe: { flex: 1, backgroundColor: colors.background },
  body: {
    flex: 1,
    padding: space.xxl,
    gap: space.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.brandTint,
    alignItems: "center",
    justifyContent: "center",
  },
});
