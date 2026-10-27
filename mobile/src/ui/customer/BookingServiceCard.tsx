import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Check } from "lucide-react-native";
import { Text } from "../Text";
import { colors } from "../theme";
export function BookingServiceCard({
  selected,
  title,
  subtitle,
  icon,
  children,
  onPress,
}: {
  selected: boolean;
  title: string;
  subtitle: string;
  icon: ReactNode;
  children?: ReactNode;
  onPress: () => void;
}) {
  return (
    <View
      style={{
        borderRadius: 18,
        padding: 14,
        gap: 14,
        backgroundColor: colors.surface,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.brand : colors.border,
      }}
    >
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={title}
        accessibilityState={{ checked: selected }}
        onPress={onPress}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            backgroundColor: selected ? colors.brandTint : colors.surface2,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="bold">{title}</Text>
          <Text size="xs" tone="muted">
            {subtitle}
          </Text>
        </View>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 8,
            borderWidth: 2,
            borderColor: selected ? colors.brand : colors.border,
            backgroundColor: selected ? colors.brand : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {selected && <Check size={14} color={colors.surface} />}
        </View>
      </Pressable>
      {selected && children}
    </View>
  );
}
