import { View } from "react-native";
import { Check } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Text } from "./Text";
import { colors, radius, space } from "./theme";

/** Presentation only: the wizard owns the current step and all navigation. */
export function BookingProgress({ step }: { step: number }) {
  const { t } = useTranslation();
  const labels = ["service", "time", "details", "review"] as const;
  return (
    <View
      style={{ gap: space.md }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: 4, now: step + 1 }}
      accessibilityLabel={t("customerRound2.step", { step: String(step + 1), total: "4" })}
    >
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {labels.map((key, index) => (
          <View key={key} style={{ flex: 1, gap: space.sm, alignItems: "center" }}>
            <View
              style={{
                height: 4,
                alignSelf: "stretch",
                borderRadius: radius.pill,
                backgroundColor: index <= step ? colors.brand : colors.border,
              }}
            />
            <View style={{ minHeight: 24, justifyContent: "center" }}>
              {index < step ? (
                <Check size={18} color={colors.brand} accessible={false} />
              ) : (
                <Text size="xs" weight="heavy" tone={index === step ? "brand" : "muted"}>
                  {String(index + 1)}
                </Text>
              )}
            </View>
            <Text
              size="xs"
              weight={index === step ? "heavy" : "regular"}
              tone={index === step ? "brand" : "muted"}
            >
              {t(`mobile.polish.${key}`)}
            </Text>
          </View>
        ))}
      </View>
      <Text size="sm" tone="muted">
        {t("customerRound2.step", { step: String(step + 1), total: "4" })}
      </Text>
    </View>
  );
}
