import { Pressable, StyleSheet, View } from "react-native";
import type { ComponentType } from "react";
import { Text } from "./Text";
import { colors, radius, shadow } from "./theme";

type IconType = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

/** Two-option pill switch (same look as the web login). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  brandSelection = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: IconType }[];
  brandSelection?: boolean;
}) {
  return (
    <View
      style={[styles.track, brandSelection && { borderRadius: 999, padding: 6, gap: 6 }]}
      accessibilityRole="tablist"
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.item,
              brandSelection && { borderRadius: 999 },
              active && styles.active,
              pressed && { opacity: 0.75 },
            ]}
          >
            {Icon ? (
              <Icon size={16} strokeWidth={2.4} color={active ? colors.brand : colors.muted} />
            ) : null}
            <Text
              size={brandSelection ? "sm" : "md"}
              weight="heavy"
              tone={active ? "default" : "muted"}
              style={active && brandSelection ? { color: colors.brand } : undefined}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  item: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  active: { backgroundColor: colors.surface, ...shadow.card, shadowOpacity: 0.06 },
});
