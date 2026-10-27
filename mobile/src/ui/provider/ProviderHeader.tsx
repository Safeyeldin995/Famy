import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight } from "lucide-react-native";
import { Text } from "@/ui/Text";
import { colors } from "@/ui/theme";

export function ProviderHeader({
  title,
  action,
  onBack,
}: {
  title: string;
  action?: ReactNode;
  onBack?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const Arrow = i18n.language.startsWith("ar") ? ArrowRight : ArrowLeft;
  return (
    <View
      style={{
        minHeight: 72,
        paddingHorizontal: 20,
        backgroundColor: colors.surface,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.back")}
        onPress={onBack ?? (() => router.back())}
        style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      >
        <Arrow size={22} color={colors.foreground} />
      </Pressable>
      <Text weight="heavy" size="title" style={{ flex: 1 }} numberOfLines={1}>
        {title}
      </Text>
      {action}
    </View>
  );
}
