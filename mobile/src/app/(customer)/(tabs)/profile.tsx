import { useState } from "react";
import { Page, QueryState, ActionError } from "@/ui/Page";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  Globe,
  LogOut,
  MapPin,
  Users,
  Bell,
  HelpCircle,
  FileText,
  Shield,
  Heart,
  Tag,
} from "lucide-react-native";
import { reloadAppAsync } from "expo";
import { applyDirection, saveLanguage } from "@/lib/i18n";
import { useMyProfile, useDefaultAddress } from "@/lib/queries";
import { signOutWithPushRevoke } from "@/lib/push";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { Avatar } from "@/ui/ProviderCard";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { CustomerMenuSection, CustomerMenuRow } from "@/ui/customer/Primitives";

export default function Profile() {
  const { t, i18n } = useTranslation();
  const profile = useMyProfile();
  const address = useDefaultAddress();
  const [actionError, setActionError] = useState(false);

  const switchLanguage = async () => {
    const next = i18n.language === "en" ? "ar" : "en";
    await saveLanguage(next);
    await i18n.changeLanguage(next);
    // Layout direction only changes after a reload in React Native.
    if (applyDirection(next)) await reloadAppAsync();
  };

  return (
    <Page
      tab
      title={t("nav.profile")}
      queries={[profile, address]}
      header={
        <CustomerPageHeader
          title={t("profile.title")}
          subtitle={t("profile.subtitle")}
          right={
            <Button
              variant="ghost"
              label={i18n.language === "ar" ? "EN" : "عربي"}
              onPress={() => void switchLanguage().catch(() => setActionError(true))}
            />
          }
        />
      }
      contentStyle={{ gap: 20, paddingTop: 16 }}
    >
      <QueryState query={profile}>
        <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 20 }]}>
          <Avatar raw={profile.data?.avatar_url} size={80} round />
          <View style={{ flex: 1, gap: 4 }}>
            <Text size="xl" weight="heavy">
              {profile.data?.full_name || t("profile.famioUser")}
            </Text>
            <Text tone="muted" weight="bold" style={{ direction: "ltr" }}>
              {profile.data?.phone || "—"}
            </Text>
          </View>
        </View>
      </QueryState>
      <CustomerMenuSection title={t("profile.myFamio")}>
        <CustomerMenuRow
          Icon={Heart}
          label={t("profile.favorites")}
          onPress={() => router.push("/favorites")}
        />
        <CustomerMenuRow
          Icon={Tag}
          label={t("profile.promoCodes")}
          detail={t("profile.promoCodesSub")}
          onPress={() => router.push("/promo-codes")}
        />
        <CustomerMenuRow
          Icon={MapPin}
          label={t("profile.addresses")}
          detail={address.data?.area || t("profile.addAddress")}
          onPress={() => router.push("/addresses")}
        />
        <CustomerMenuRow
          Icon={Users}
          label={t("profile.family")}
          detail={t("profile.familySub")}
          onPress={() => router.push("/family-members")}
          last
        />
      </CustomerMenuSection>
      <CustomerMenuSection title={t("profile.preferences")}>
        <CustomerMenuRow
          Icon={Bell}
          label={t("common.notifications")}
          onPress={() => router.push("/notifications")}
        />
        <CustomerMenuRow
          Icon={Globe}
          label={t("profile.language")}
          detail={t(i18n.language === "en" ? "common.english" : "common.arabic")}
          onPress={() => void switchLanguage().catch(() => setActionError(true))}
          last
        />
      </CustomerMenuSection>
      <CustomerMenuSection title={t("profile.support")}>
        <CustomerMenuRow
          Icon={HelpCircle}
          label={t("profile.help")}
          onPress={() => router.push("/help")}
        />
        <CustomerMenuRow
          Icon={FileText}
          label={t("profile.terms")}
          onPress={() => router.push({ pathname: "/content/[key]", params: { key: "terms" } })}
        />
        <CustomerMenuRow
          Icon={Shield}
          label={t("profile.privacy")}
          onPress={() => router.push({ pathname: "/content/[key]", params: { key: "privacy" } })}
          last
        />
      </CustomerMenuSection>
      <ActionError error={actionError} />
      <View style={{ gap: space.md, marginTop: "auto" }}>
        <Button
          variant="secondary"
          label={t("profile.logout")}
          icon={<LogOut size={18} color={colors.destructive} />}
          onPress={async () => {
            const { error } = await signOutWithPushRevoke();
            if (error) {
              setActionError(true);
              return;
            }
            router.replace("/login");
          }}
        />
      </View>
      <Button
        variant="ghost"
        label={t("accountDeletion.menuLabel")}
        onPress={() => router.push("/delete-account")}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, padding: space.xl, gap: space.lg },
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
