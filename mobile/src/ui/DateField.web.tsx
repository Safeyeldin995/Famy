import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Text } from "./Text";
import { colors } from "./theme";
import type { DateFieldProps } from "./DateField";
export function DateField({ label, value, onChange, maximumDate }: DateFieldProps) {
  const { i18n } = useTranslation();
  return (
    <View>
      <Text weight="bold">{label}</Text>
      <input
        type="date"
        lang={i18n.language}
        aria-label={label}
        value={value}
        max={
          maximumDate
            ? `${maximumDate.getFullYear()}-${String(maximumDate.getMonth() + 1).padStart(2, "0")}-${String(maximumDate.getDate()).padStart(2, "0")}`
            : undefined
        }
        onChange={(e) => onChange(e.target.value)}
        style={{
          minHeight: 48,
          fontSize: 16,
          color: colors.ink,
          background: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          direction: "ltr",
        }}
      />
    </View>
  );
}
