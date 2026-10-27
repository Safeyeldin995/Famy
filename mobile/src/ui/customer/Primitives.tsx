import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Text } from "../Text";
import { colors } from "../theme";

/** Layout tokens and controls copied from the web customer screens. */
export const customerStyle = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 12,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandTint,
    alignItems: "center",
    justifyContent: "center",
  },
});
export function CustomerEmpty({
  Icon,
  title,
  body,
  children,
}: {
  Icon: LucideIcon;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 40, gap: 12 }}>
      <View style={[customerStyle.icon, { width: 80, height: 80, borderRadius: 28 }]}>
        <Icon size={32} color={colors.brand} />
      </View>
      <Text size="xl" weight="heavy" style={{ textAlign: "center" }}>
        {title}
      </Text>
      {body ? (
        <Text tone="muted" style={{ textAlign: "center", lineHeight: 24 }}>
          {body}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
export function CustomerChips({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      style={{ flexGrow: 0, height: 44 }}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="button"
          accessibilityState={{ selected: value === option.value }}
          onPress={() => onChange(option.value)}
          style={{
            minHeight: 44,
            borderRadius: 24,
            borderWidth: 0,
            borderColor: value === option.value ? colors.brand : colors.border,
            backgroundColor: value === option.value ? colors.brand : colors.surface2,
            paddingHorizontal: 16,
            justifyContent: "center",
          }}
        >
          <Text size="sm" weight="bold" tone={value === option.value ? "inverse" : "default"}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
export function CustomerMenuRow({
  Icon,
  label,
  detail,
  onPress,
  last = false,
}: {
  Icon: LucideIcon;
  label: string;
  detail?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { i18n } = useTranslation();
  const Arrow = i18n.language === "ar" ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        customerStyle.row,
        {
          paddingHorizontal: 20,
          paddingVertical: 16,
          gap: 16,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={customerStyle.icon}>
        <Icon size={20} color={colors.brand} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text size="lg" weight="heavy">
          {label}
        </Text>
        {detail ? (
          <Text size="xs" weight="bold" tone="muted">
            {detail}
          </Text>
        ) : null}
      </View>
      <Arrow size={20} color={colors.muted} />
    </Pressable>
  );
}
export function CustomerMenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 12, marginTop: 12 }}>
      <Text size="xs" weight="heavy" tone="muted">
        {title}
      </Text>
      <View
        style={{
          borderRadius: 28,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        {children}
      </View>
    </View>
  );
}
