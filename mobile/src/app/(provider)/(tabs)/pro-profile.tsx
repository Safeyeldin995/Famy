import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Globe, LogOut } from "lucide-react-native";
import { reloadAppAsync } from "expo";
import { applyDirection, saveLanguage } from "@/lib/i18n";
import { useMyProvider, useMyProviderServices } from "@/lib/provider/queries";
import { supabase } from "@/lib/supabase";
import { localized } from "@/lib/presentation";
import { proCard } from "@/ui/provider/cards";
import { Page, QueryState, Row, ActionError } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

export default function ProviderProfile() {
  const { t, i18n } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const servicesQ = useMyProviderServices(provider?.id as string | undefined);
  const profile = provider?.profile as { full_name?: string; phone?: string } | undefined;
  const [actionError, setActionError] = useState(false);

  const switchLanguage = async () => {
    const next = i18n.language === "en" ? "ar" : "en";
    await saveLanguage(next);
    await i18n.changeLanguage(next);
    if (applyDirection(next)) await reloadAppAsync();
  };

  return (
    <Page tab title={t("pro.nav.profile")} queries={[p, servicesQ]}>
      <QueryState query={p}>
        <View style={proCard.card}>
          <Text size="lg" weight="heavy">
            {profile?.full_name || t("greetings.there")}
          </Text>
          {provider?.city ? <Text tone="muted">{String(provider.city)}</Text> : null}
          {provider?.years_experience != null ? (
            <Text tone="muted">
              {t("pro.profile.yearsExperience")}: {String(provider.years_experience)}
            </Text>
          ) : null}
        </View>
      </QueryState>
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
          label={t("pro.profile.signOut")}
          icon={<LogOut size={18} color={colors.destructive} />}
          onPress={async () => {
            const { error } = await supabase.auth.signOut();
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
