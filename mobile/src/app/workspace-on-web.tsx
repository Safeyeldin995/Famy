import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { Briefcase, ShieldCheck } from "lucide-react-native";
import { appConfig, supabase } from "@/lib/supabase";
import { resolveWorkspace, useSession, type Workspace } from "@/lib/session";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

/**
 * Providers land here until their screens ship in the app. Admins see a single
 * message and sign-out; customer and provider tabs stay hidden via entry routing.
 */
export default function WorkspaceOnWeb() {
  const { t } = useTranslation();
  const { session } = useSession();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    resolveWorkspace(session.user.id).then((result) => {
      if (!cancelled) setWorkspace(result.workspace);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const isAdmin = workspace === "admin";

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <View style={styles.icon}>
          {isAdmin ? (
            <ShieldCheck size={28} color={colors.brand} />
          ) : (
            <Briefcase size={28} color={colors.brand} />
          )}
        </View>
        <Text size="xxl" weight="heavy" style={{ textAlign: "center" }}>
          {t(isAdmin ? "mobile.adminAccountTitle" : "mobile.workspaceOnWebTitle")}
        </Text>
        <Text tone="muted" style={{ textAlign: "center" }}>
          {t(isAdmin ? "mobile.adminAccountBody" : "mobile.workspaceOnWebBody")}
        </Text>
        <Button
          label={t(isAdmin ? "mobile.openAdminOnWeb" : "mobile.openOnWeb")}
          onPress={() => WebBrowser.openBrowserAsync(`${appConfig.webOrigin}/staff`)}
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
