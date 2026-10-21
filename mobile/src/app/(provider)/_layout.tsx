import { Stack, Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSession } from "@/lib/session";
import { ProviderGate } from "@/ui/provider/ProviderGate";
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
    <ProviderGate>
      <Stack
        screenOptions={{
          headerTintColor: colors.brand,
          headerStyle: { backgroundColor: colors.background },
          headerTitleStyle: { fontFamily: (i18n.language === "ar" ? fonts.ar : fonts.en).bold },
          headerBackTitle: t("common.back"),
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="pro-booking/[id]" options={{ title: t("pro.booking.title") }} />
        <Stack.Screen name="pro-notifications" options={{ title: t("notifs.title") }} />
      </Stack>
    </ProviderGate>
  );
}
