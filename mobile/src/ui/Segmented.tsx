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
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: IconType }[];
}) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.item, active && styles.active]}
          >
            {Icon ? (
              <Icon size={16} strokeWidth={2.4} color={active ? colors.brand : colors.muted} />
            ) : null}
            <Text weight="heavy" tone={active ? "default" : "muted"}>
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
    minHeight: 44,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  active: { backgroundColor: colors.surface, ...shadow.card, shadowOpacity: 0.06 },
});
