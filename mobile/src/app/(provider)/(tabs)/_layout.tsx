import { Redirect } from "expo-router";
import { Tabs } from "expo-router/tabs";
import { useTranslation } from "react-i18next";
import { ClipboardList, LayoutDashboard, User, Wallet } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";
import { useSession } from "@/lib/session";
import { ProviderGate } from "@/ui/provider/ProviderGate";
import { colors } from "@/ui/theme";
import { scaledTabBarHeight } from "@/ui/a11y";
import { tabBarLabelStyle } from "@/ui/navigationTypography";

export default function ProviderTabs() {
  const { session, ready } = useSession();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  if (ready && !session) return <Redirect href="/login" />;
  return (
    <ProviderGate>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.brandText,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabelStyle: tabBarLabelStyle(i18n.language),
          tabBarStyle: {
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
            height: scaledTabBarHeight(fontScale, 18, insets.bottom),
            paddingTop: 6,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        }}
      >
        <Tabs.Screen
          name="dashboard"
          options={{
            title: t("pro.nav.dashboard"),
            tabBarIcon: ({ color, focused }) => (
              <LayoutDashboard size={22} color={focused ? colors.brand : color} />
            ),
          }}
        />
        <Tabs.Screen
          name="jobs"
          options={{
            title: t("pro.nav.jobs"),
            tabBarIcon: ({ color, focused }) => (
              <ClipboardList size={22} color={focused ? colors.brand : color} />
            ),
          }}
        />
        <Tabs.Screen
          name="earnings"
          options={{
            title: t("pro.nav.earnings"),
            tabBarIcon: ({ color, focused }) => (
              <Wallet size={22} color={focused ? colors.brand : color} />
            ),
          }}
        />
        <Tabs.Screen
          name="pro-profile"
          options={{
            title: t("pro.nav.profile"),
            tabBarIcon: ({ color, focused }) => (
              <User size={22} color={focused ? colors.brand : color} />
            ),
          }}
        />
      </Tabs>
    </ProviderGate>
  );
}
