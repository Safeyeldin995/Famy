import type { ComponentProps } from "react";
import { Tabs } from "expo-router/tabs";
import { Pressable, StyleSheet, View } from "react-native";
import { Calendar, Home, MessageCircle, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Text } from "./Text";
import { colors } from "./theme";

const tabs = { home: Home, bookings: Calendar, messages: MessageCircle, profile: User };
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];
export function CustomerBottomNav({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: Math.max(insets.bottom, 8),
          flexDirection: i18n.language === "ar" ? "row-reverse" : "row",
        },
      ]}
    >
      {state.routes
        .filter((route) => route.name in tabs)
        .map((route) => {
          const name = route.name as keyof typeof tabs;
          const Icon = tabs[name];
          const active = state.routes[state.index].key === route.key;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={t(`nav.${name}`)}
              accessibilityState={{ selected: active }}
              style={styles.tab}
              onPress={() => {
                const event = emitter.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!active && !event.defaultPrevented) navigateToTab(route.key);
              }}
              onLongPress={() => emitter.emit({ type: "tabLongPress", target: route.key })}
            >
              <View style={[styles.icon, active && { backgroundColor: "rgba(241,14,114,.12)" }]}>
                <Icon
                  size={20}
                  strokeWidth={active ? 2.5 : 1.75}
                  color={active ? colors.brand : colors.muted}
                />
              </View>
              <Text size="xs" weight="heavy" tone={active ? "brand" : "muted"}>
                {t(`nav.${name}`)}
              </Text>
            </Pressable>
          );
        })}
    </View>
  );
}
const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    direction: "ltr",
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(230,224,228,.5)",
    backgroundColor: "rgba(255,255,255,.95)",
    shadowColor: "#25141d",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  tab: {
    flex: 1,
    minHeight: 64,
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingTop: 10,
    borderRadius: 24,
  },
  icon: { height: 36, width: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
});
