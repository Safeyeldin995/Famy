import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Camera, Globe, LogOut, ShieldCheck } from "lucide-react-native";
import { reloadAppAsync } from "expo";
import { applyDirection, saveLanguage } from "@/lib/i18n";
import { useMyProvider, useMyProviderServices } from "@/lib/provider/queries";
import { signOutWithPushRevoke } from "@/lib/push";
import { localized } from "@/lib/presentation";
import { proCard } from "@/ui/provider/cards";
import { Page, QueryState, Row, ActionError } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

export default function ProviderProfile() {
  const { t, i18n } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const servicesQ = useMyProviderServices(provider?.id as string | undefined);
  const profile = provider?.profile as
    { full_name?: string; phone?: string; avatar_url?: string } | undefined;
  const [actionError, setActionError] = useState(false);

  const switchLanguage = async () => {
    const next = i18n.language === "en" ? "ar" : "en";
    await saveLanguage(next);
    await i18n.changeLanguage(next);
    if (applyDirection(next)) await reloadAppAsync();
  };

  return (
    <Page tab title={t("pro.nav.profile")} queries={[p, servicesQ]} contentStyle={{ gap: 16 }}>
      <QueryState query={p}>
        <View
          style={[
            proCard.card,
            {
              borderRadius: radius.xl,
              padding: 20,
              flexDirection: "row",
              alignItems: "center",
              gap: 16,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("pro.profile.changePhoto")}
            onPress={() => router.push("/pro-profile-edit")}
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: colors.brandTint,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {profile?.avatar_url?.startsWith("http") ? (
              <Image
                source={{ uri: profile.avatar_url }}
                style={{ width: 64, height: 64, borderRadius: 32 }}
              />
            ) : (
              <Text tone="brand" weight="heavy">
                {(profile?.full_name || t("greetings.there")).slice(0, 1)}
              </Text>
            )}
            <View
              style={{
                position: "absolute",
                bottom: 0,
                end: 0,
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: colors.brand,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Camera size={14} color={colors.brandForeground} />
            </View>
          </Pressable>
          <View style={{ flex: 1, gap: 6 }}>
            <Text size="lg" weight="heavy">
              {profile?.full_name || t("greetings.there")}
            </Text>
            <View
              style={{
                alignSelf: "flex-start",
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: provider?.is_verified ? "#E7F7EF" : colors.surface2,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 999,
              }}
            >
              <ShieldCheck
                size={14}
                color={provider?.is_verified ? colors.success : colors.muted}
              />
              <Text size="xs" tone={provider?.is_verified ? "success" : "muted"}>
                {t(
                  provider?.is_verified
                    ? "pro.profile.verified"
                    : "pro.profile.verificationPending",
                )}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("pro.profile.changePhoto")}
              onPress={() => router.push("/pro-profile-edit")}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text tone="brand" size="xs" weight="bold">
                {t("pro.profile.changePhoto")}
              </Text>
            </Pressable>
          </View>
        </View>
      </QueryState>
      <Text weight="bold" tone="muted" size="sm">
        {t("pro.profile.about")}
      </Text>
      <View style={proCard.card}>
        <Text weight="bold" size="sm">
          {t("pro.profile.bioAr")}
        </Text>
        <Text
          style={{
            backgroundColor: colors.surface2,
            borderRadius: radius.lg,
            padding: 16,
            minHeight: 72,
          }}
        >
          {String((i18n.language.startsWith("ar") ? provider?.bio_ar : provider?.bio_en) || "")}
        </Text>
        {provider?.years_experience != null ? (
          <Text tone="muted" size="sm">
            {t("pro.profile.yearsExperience")}: {String(provider.years_experience)}
          </Text>
        ) : null}
        {provider?.city ? (
          <Text tone="muted" size="sm">
            {String(provider.city)}
          </Text>
        ) : null}
      </View>
      <Text weight="bold" tone="muted">
        {t("mobile.servicesPrices")}
      </Text>
      <QueryState query={servicesQ} empty={!servicesQ.data?.length} emptyKey="mobile.empty">
        {servicesQ.data?.map((row) => {
          const service = row.service as { name_ar?: string; name_en?: string } | null;
          return (
            <View key={row.service_id} style={proCard.card}>
              <Text weight="bold">{localized(service, i18n.language)}</Text>
            </View>
          );
        })}
      </QueryState>
      <Row label={t("pro.profile.title")} onPress={() => router.push("/pro-profile-edit")} />
      <Row label={t("providerDocuments.title")} onPress={() => router.push("/pro-documents")} />
      <Row label={t("common.notifications")} onPress={() => router.push("/pro-notifications")} />
      <Row
        label={t("mobilePro.notificationPrefs")}
        onPress={() => router.push("/pro-notification-preferences")}
      />
      <ActionError error={actionError} />
      <View style={{ gap: space.md, marginTop: space.lg }}>
        <Button
          variant="secondary"
          label={`${t("profile.language")}: ${i18n.language === "en" ? t("common.english") : t("common.arabic")}`}
          icon={<Globe size={18} color={colors.foreground} />}
          onPress={() => void switchLanguage().catch(() => setActionError(true))}
        />
        <Button
          variant="secondary"
          label={t("accountDeletion.menuLabel")}
          onPress={() => router.push("/pro-delete-account")}
        />
        <Button
          variant="secondary"
          label={t("pro.profile.signOut")}
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
    </Page>
  );
}
