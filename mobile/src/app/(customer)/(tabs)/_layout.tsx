import { Redirect } from "expo-router";
import { Tabs } from "expo-router/tabs";
import { useTranslation } from "react-i18next";
import { Calendar, Home, MessageCircle, User } from "lucide-react-native";
import { useSession } from "@/lib/session";
import { colors, fonts } from "@/ui/theme";
import { COMPACT_FONT_SCALE_CAP, scaledTabBarHeight } from "@/ui/a11y";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View, useWindowDimensions, type TextStyle } from "react-native";
import { CustomerBottomNav } from "@/ui/CustomerBottomNav";

export default function CustomerTabs() {
  const { session, ready } = useSession();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  if (ready && !session) return <Redirect href="/login" />;
  const labelFont = (i18n.language === "en" ? fonts.en : fonts.ar).bold;

  return (
    <Tabs
      tabBar={(props) => <CustomerBottomNav {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandText,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontFamily: labelFont,
          fontSize: 11,
          lineHeight: 22,
          maxFontSizeMultiplier: COMPACT_FONT_SCALE_CAP,
        } as TextStyle,
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
        name="messages"
        options={{
          title: t("nav.messages"),
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
              <MessageCircle size={22} color={focused ? colors.brand : color} />
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
