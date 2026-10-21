import { Pressable, View } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { buildPriceOptions, isPriceInRange } from "@shared/provider/priceOptions";
import { money } from "@/lib/presentation";
import { useTranslation } from "react-i18next";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

function stepperPrice(value: number, direction: -1 | 1, min: number | null, max: number | null) {
  const options = buildPriceOptions(min, max);
  if (options.length) {
    return direction === 1
      ? (options.find((p) => p > value) ?? max!)
      : ([...options].reverse().find((p) => p < value) ?? min!);
  }
  return Math.max(min ?? 50, Math.min(max ?? Infinity, value + direction * 50));
}

export function ProviderPriceStepper({
  min,
  max,
  value,
  onChange,
  disabled,
}: {
  min: number | null;
  max: number | null;
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const current = value ?? min ?? 50;
  const inRange = isPriceInRange(current, min, max);
  const bump = (dir: -1 | 1) => onChange(stepperPrice(current, dir, min, max));

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("pricePicker.decrease")}
          disabled={disabled}
          onPress={() => bump(-1)}
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Minus size={20} color={colors.foreground} />
        </Pressable>
        <Text weight="heavy" size="lg" style={{ flex: 1, textAlign: "center" }}>
          {money(current, i18n.language)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("pricePicker.increase")}
          disabled={disabled}
          onPress={() => bump(1)}
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Plus size={20} color={colors.foreground} />
        </Pressable>
      </View>
      {!inRange ? (
        <Text tone="danger" size="sm">
          {t("mobilePro.priceOutOfRange")}
        </Text>
      ) : null}
    </View>
  );
}
