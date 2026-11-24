import { Stack, Redirect } from "expo-router";
import { ActivityIndicator, View, type TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { useAdminOnlyMobileBlock, useSession } from "@/lib/session";
import { colors } from "@/ui/theme";
import { stackHeaderTitleStyle } from "@/ui/navigationTypography";
export default function CustomerStack() {
  const { session, ready } = useSession();
  const adminBlock = useAdminOnlyMobileBlock();
  const { t, i18n } = useTranslation();
  if (!ready || !adminBlock.ready)
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  if (!session) return <Redirect href="/login" />;
  if (adminBlock.blocked) return <Redirect href="/workspace-on-web" />;
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.brand,
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        headerTitleAlign: "center",
        headerTitleStyle: stackHeaderTitleStyle(i18n.language, "heavy") as TextStyle,
        headerBackTitle: t("common.back"),
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
