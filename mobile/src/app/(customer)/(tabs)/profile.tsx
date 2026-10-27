import { useState } from "react";
import { Page, QueryState, ActionError } from "@/ui/Page";
import { Pressable, StyleSheet, View } from "react-native";
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
import { colors } from "@/ui/theme";
import { CustomerProfilePhoto } from "@/ui/customer/CustomerProfilePhoto";
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(
                i18n.language === "ar" ? "common.switchToEnglish" : "common.switchToArabic",
              )}
              style={styles.language}
              onPress={() => void switchLanguage().catch(() => setActionError(true))}
            >
              <Text size="xs" weight="heavy">
                {t(i18n.language === "ar" ? "common.langShortEn" : "common.langShortAr")}
              </Text>
            </Pressable>
          }
        />
      }
      contentStyle={{ gap: 0, paddingTop: 16 }}
    >
      <QueryState query={profile}>
        <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 20 }]}>
          <CustomerProfilePhoto
            src={profile.data?.avatar_url}
            name={profile.data?.full_name || t("profile.famioUser")}
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Text size="xl" weight="heavy">
              {profile.data?.full_name || t("profile.famioUser")}
            </Text>
            <Text tone="muted" weight="bold" style={{ direction: "ltr" }}>
              {profile.data?.phone || "—"}
            </Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t("customerHome.profileEdit")}
              onPress={() => router.push("/setup")}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text size="xs" weight="bold" style={{ color: colors.brand }}>
                {t("customerHome.profileEdit")}
              </Text>
            </Pressable>
          </View>
        </View>
      </QueryState>
      <View style={{ paddingTop: 16 }}>
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
            detail={
              address.data?.area === "Sheikh Zayed"
                ? t("customerAreas.sheikhZayed")
                : address.data?.area === "6th of October"
                  ? t("customerAreas.october")
                  : address.data?.area || t("profile.addAddress")
            }
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
            detail={t("notifPrefs.title")}
            onPress={() => router.push("/notification-preferences")}
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
        <View style={{ gap: 8, marginTop: 24 }}>
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
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  language: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.surface,
    boxShadow: "0px 4px 16px rgba(42,30,37,0.06)",
  },
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
