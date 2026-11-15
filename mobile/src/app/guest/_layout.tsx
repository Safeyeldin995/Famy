import { Stack } from "expo-router";
import type { TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { colors } from "@/ui/theme";
import { stackHeaderTitleStyle } from "@/ui/navigationTypography";

/** Signed-out browsing. No session guard: these screens only read public marketplace data. */
export default function GuestStack() {
  const { t, i18n } = useTranslation();
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
    />
  );
}
