import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import type { ReactNode } from "react";
import { Text } from "./Text";
import { colors, radius, shadow } from "./theme";

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  style?: ViewStyle;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      disabled={!!inactive}
      aria-disabled={!!inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        inactive && styles.disabled,
        pressed && !inactive && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.brandForeground : colors.brand} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text
            size="lg"
            weight="heavy"
            tone={variant === "primary" ? "inverse" : variant === "ghost" ? "brand" : "default"}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  primary: {
    backgroundColor: colors.brand,
    ...shadow.card,
    shadowColor: colors.brand,
    shadowOpacity: 0.16,
  },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  disabled: { opacity: 0.5 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    flexShrink: 1,
  },
});
