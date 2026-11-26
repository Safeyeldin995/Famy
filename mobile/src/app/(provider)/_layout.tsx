import { Stack, Redirect } from "expo-router";
import { ActivityIndicator, View, type TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { useAdminOnlyMobileBlock, useSession } from "@/lib/session";
import { colors } from "@/ui/theme";
import { stackHeaderTitleStyle } from "@/ui/navigationTypography";

export default function ProviderStack() {
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
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: stackHeaderTitleStyle(i18n.language, "bold") as TextStyle,
        headerBackTitle: t("common.back"),
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="pro-booking/[id]" options={{ title: t("pro.booking.title") }} />
      <Stack.Screen name="pro-chat/[id]" options={{ title: t("nav.messages") }} />
      <Stack.Screen name="pro-messages" options={{ headerShown: false }} />
      <Stack.Screen name="pro-notifications" options={{ title: t("notifs.title") }} />
      <Stack.Screen name="pro-apply" options={{ title: t("providerApply.checklist") }} />
      <Stack.Screen name="pro-documents" options={{ title: t("providerDocuments.title") }} />
      <Stack.Screen name="pro-setup-home" options={{ title: t("providerApply.checklist") }} />
      <Stack.Screen name="pro-setup/[item]" options={{ title: t("providerApply.checklist") }} />
      <Stack.Screen name="pro-profile-edit" options={{ title: t("pro.profile.title") }} />
      <Stack.Screen name="pro-my-reviews" options={{ title: t("proReviews.title") }} />
      <Stack.Screen
        name="pro-notification-preferences"
        options={{ title: t("mobilePro.notificationPrefs") }}
      />
      <Stack.Screen name="pro-onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="pro-help" options={{ title: t("helpC.title") }} />
      <Stack.Screen name="pro-delete-account" options={{ title: t("accountDeletion.title") }} />
    </Stack>
  );
}
