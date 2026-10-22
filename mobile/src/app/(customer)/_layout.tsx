import { Stack, Redirect } from "expo-router";
import { ActivityIndicator, View, type TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { useSession } from "@/lib/session";
import { COMPACT_FONT_SCALE_CAP } from "@/ui/a11y";
import { colors, fontSize, fonts } from "@/ui/theme";
export default function CustomerStack() {
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
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        headerTitleAlign: "center",
        headerTitleStyle: {
          fontFamily: (i18n.language === "ar" ? fonts.ar : fonts.en).heavy,
          fontSize: fontSize.xl,
          maxFontSizeMultiplier: COMPACT_FONT_SCALE_CAP,
          color: colors.brandText,
        } as TextStyle,
        headerBackTitle: t("common.back"),
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
