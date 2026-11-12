import { Redirect } from "expo-router";
import { Tabs } from "expo-router/tabs";
import { useTranslation } from "react-i18next";
import { Calendar, Home, User } from "lucide-react-native";
import { useSession } from "@/lib/session";
import { colors } from "@/ui/theme";
import { scaledTabBarHeight } from "@/ui/a11y";
import { tabBarLabelStyle } from "@/ui/navigationTypography";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View, useWindowDimensions } from "react-native";
import { CustomerBottomNav } from "@/ui/CustomerBottomNav";

export default function CustomerTabs() {
  const { session, ready } = useSession();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  if (ready && !session) return <Redirect href="/login" />;
  return (
    <Tabs
      tabBar={(props) => <CustomerBottomNav {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandText,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: tabBarLabelStyle(i18n.language),
        tabBarStyle: {
          direction: i18n.language === "ar" ? "rtl" : "ltr",
          marginHorizontal: 12,
          marginBottom: 12,
          borderRadius: 28,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          height: scaledTabBarHeight(fontScale, 22, insets.bottom),
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t("nav.home"),
          tabBarIcon: ({ color, focused }) => (
            <View
              style={{
                width: 56,
                height: 36,
                borderRadius: 999,
                backgroundColor: focused ? colors.brandTint : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Home size={22} color={focused ? colors.brand : color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: t("nav.bookings"),
          tabBarIcon: ({ color, focused }) => (
            <View
              style={{
                width: 56,
                height: 36,
                borderRadius: 999,
                backgroundColor: focused ? colors.brandTint : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Calendar size={22} color={focused ? colors.brand : color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("nav.profile"),
          tabBarIcon: ({ color, focused }) => (
            <View
              style={{
                width: 56,
                height: 36,
                borderRadius: 999,
                backgroundColor: focused ? colors.brandTint : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <User size={22} color={focused ? colors.brand : color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
