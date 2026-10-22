import { Redirect } from "expo-router";
import { Tabs } from "expo-router/tabs";
import { useTranslation } from "react-i18next";
import { Calendar, Home, MessageCircle, User } from "lucide-react-native";
import { useSession } from "@/lib/session";
import { colors, fonts } from "@/ui/theme";
import { scaledTabBarHeight } from "@/ui/a11y";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";

export default function CustomerTabs() {
  const { session, ready } = useSession();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  if (ready && !session) return <Redirect href="/login" />;
  const labelFont = (i18n.language === "en" ? fonts.en : fonts.ar).bold;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: labelFont, fontSize: 12, lineHeight: 22 },
        tabBarStyle: {
          borderTopColor: colors.border,
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
          tabBarIcon: ({ color }) => <Home size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: t("nav.bookings"),
          tabBarIcon: ({ color }) => <Calendar size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t("nav.messages"),
          tabBarIcon: ({ color }) => <MessageCircle size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("nav.profile"),
          tabBarIcon: ({ color }) => <User size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
