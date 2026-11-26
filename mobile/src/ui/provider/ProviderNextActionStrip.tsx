import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react-native";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { colors, radius, space } from "@/ui/theme";
import type { ProviderNextAction } from "@shared/provider/providerNextAction";

export function ProviderNextActionStrip({ action }: { action: ProviderNextAction }) {
  const { t, i18n } = useTranslation();
  const label =
    action.kind === "start_job" && action.labelKey === "proNextAction.nextJob" && action.labelParams?.when
      ? t("proNextAction.nextJob", {
          time: new Intl.DateTimeFormat(
            i18n.language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB",
            {
              timeZone: "Africa/Cairo",
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            },
          ).format(new Date(String(action.labelParams.when))),
        })
      : t(action.labelKey, action.labelParams);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => action.route && router.push(action.route as never)}
      style={{
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.brand,
        backgroundColor: colors.brandTint,
        padding: space.md,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text weight="heavy" style={{ flex: 1 }}>
          {label}
        </Text>
        <ChevronLeft size={20} color={colors.brand} style={{ transform: [{ scaleX: i18n.language.startsWith("ar") ? -1 : 1 }] }} />
      </View>
      {action.ctaKey ? (
        <Button
          label={t(action.ctaKey)}
          variant="secondary"
          onPress={() => action.route && router.push(action.route as never)}
        />
      ) : null}
    </Pressable>
  );
}