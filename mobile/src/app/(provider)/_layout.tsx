import { Stack, Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSession } from "@/lib/session";
import { colors, fonts } from "@/ui/theme";

export default function ProviderStack() {
  const { session, ready } = useSession();
  const { t, i18n } = useTranslation();
  if (!ready)
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  if (!session) return <Redirect href="/login" />;
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.brand,
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: {
          fontFamily: (i18n.language === "ar" ? fonts.ar : fonts.en).bold,
          color: colors.brandText,
        },
        headerBackTitle: t("common.back"),
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="pro-booking/[id]" options={{ title: t("pro.booking.title") }} />
      <Stack.Screen name="pro-chat/[id]" options={{ title: t("nav.messages") }} />
      <Stack.Screen name="pro-notifications" options={{ title: t("notifs.title") }} />
      <Stack.Screen name="pro-apply" options={{ title: t("providerApply.checklist") }} />
      <Stack.Screen name="pro-documents" options={{ title: t("providerDocuments.title") }} />
      <Stack.Screen name="pro-setup-home" options={{ title: t("providerApply.checklist") }} />
      <Stack.Screen name="pro-setup/[item]" options={{ title: t("providerApply.checklist") }} />
      <Stack.Screen name="pro-profile-edit" options={{ title: t("pro.profile.title") }} />
      <Stack.Screen
        name="pro-notification-preferences"
        options={{ title: t("mobilePro.notificationPrefs") }}
      />
      <Stack.Screen name="pro-onboarding" options={{ headerShown: false }} />
    </Stack>
  );
}
