import { useEffect, useState } from "react";
import { View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { isTutoringCategorySlug } from "@/lib/tutoring/teachingCapabilities";
import { saveProfileChanges, type ProfileFields } from "@shared/provider/saveProfileChanges";
import { isPriceInRange } from "@shared/provider/priceOptions";
import { uploadAvatar } from "@/lib/provider/documentUpload";
import {
  useAllServices,
  useMyProviderServicesDetailed,
  useSetProviderPrice,
  useToggleProviderService,
} from "@/lib/provider/profileQueries";
import { useMyProvider, useUpdateProvider } from "@/lib/provider/queries";
import { localized, money } from "@/lib/presentation";
import { supabase } from "@/lib/supabase";
import { ProviderPriceStepper } from "@/ui/provider/ProviderPriceStepper";
import { proCard } from "@/ui/provider/cards";
import { Page, QueryState, Field, ActionError } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

export default function ProProfileEditScreen() {
  const { t, i18n } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const providerId = provider?.id as string | undefined;
  const profileId = provider?.profile_id as string | undefined;
  const servicesQ = useAllServices();
  const mineQ = useMyProviderServicesDetailed(providerId);
  const toggle = useToggleProviderService();
  const setPrice = useSetProviderPrice();
  const updateProv = useUpdateProvider();
  const [bioAr, setBioAr] = useState("");
  const [bioEn, setBioEn] = useState("");
  const [priceDrafts, setPriceDrafts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);

  useEffect(() => {
    if (!provider) return;
    setBioAr(String(provider.bio_ar ?? ""));
    setBioEn(String(provider.bio_en ?? ""));
  }, [provider]);

  const saveBio = async () => {
    if (!provider) return;
    setBusy(true);
    setActionError(false);
    try {
      const edits: ProfileFields = { bio_ar: bioAr, bio_en: bioEn };
      await saveProfileChanges(
        {
          bio_ar: provider.bio_ar as string | null,
          bio_en: provider.bio_en as string | null,
          years_experience: Number(provider.years_experience ?? 0),
          city: provider.city as string | null,
          languages: (provider.languages as string[]) ?? [],
          onboarding_status: String(provider.onboarding_status),
        },
        edits,
        {
          snapshot: async () => {
            const { data, error } = await supabase.rpc("provider_onboarding_snapshot");
            if (error) throw error;
            return data as {
              provider?: ProfileFields;
              details?: { previous_work?: string | null };
            };
          },
          section: async (section, payload) => {
            const { error } = await supabase.rpc("provider_save_onboarding_section", {
              p_section: section,
              p_payload: payload,
            });
            if (error) throw error;
          },
          update: async (patch) => {
            await updateProv.mutateAsync(patch);
          },
        },
      );
    } catch {
      setActionError(true);
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = async () => {
    if (!profileId) return;
    setBusy(true);
    setActionError(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error("denied");
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]) return;
      const a = result.assets[0];
      await uploadAvatar(profileId, {
        uri: a.uri,
        mimeType: a.mimeType ?? "image/jpeg",
        fileName: a.fileName,
        fileSize: a.fileSize,
      });
      await p.refetch();
    } catch {
      setActionError(true);
    } finally {
      setBusy(false);
    }
  };

  const mine = mineQ.data ?? [];
  const selectedIds = new Set(mine.map((row: { service_id: string }) => row.service_id));

  return (
    <Page title={t("pro.profile.title")} queries={[p, servicesQ, mineQ]}>
      <QueryState query={p}>
        <Button
          variant="secondary"
          label={t("pro.profile.changePhoto")}
          loading={busy}
          onPress={() => void pickAvatar()}
        />
        <Field label={t("pro.profile.bioAr")} value={bioAr} multiline onChangeText={setBioAr} />
        <Field label={t("pro.profile.bioEn")} value={bioEn} multiline onChangeText={setBioEn} />
        <Button
          label={t("pro.profile.saveChanges")}
          loading={busy}
          onPress={() => void saveBio()}
        />
        <Text weight="heavy">{t("mobile.servicesPrices")}</Text>
      </QueryState>
      <QueryState query={servicesQ}>
        {(servicesQ.data ?? []).map((service: Record<string, unknown>) => {
          const id = String(service.id);
          const on = selectedIds.has(id);
          const row = mine.find((m: { service_id: string }) => m.service_id === id) as
            Record<string, unknown> | undefined;
          const tutoring = isTutoringCategorySlug((service.category as { slug?: string })?.slug);
          const min = service.minimum_price as number | null;
          const max = service.maximum_price as number | null;
          const current = priceDrafts[id] ?? (row?.price_override as number | null) ?? min ?? 0;
          return (
            <View key={id} style={proCard.card}>
              <Text weight="bold">{localized(service, i18n.language)}</Text>
              {row?.status ? (
                <Text tone="muted" size="sm">
                  {t(`providerSetup.status.${String(row.status)}`)}
                </Text>
              ) : null}
              <Button
                variant={on ? "primary" : "secondary"}
                label={t(on ? "mobilePro.serviceOn" : "mobilePro.serviceOff")}
                disabled={row?.status === "approved" && on}
                onPress={() => {
                  if (!providerId) return;
                  toggle.mutate({ providerId, serviceId: id, on: !on });
                }}
              />
              {on && !tutoring && service.provider_pricing_allowed ? (
                <>
                  <ProviderPriceStepper
                    min={min}
                    max={max}
                    value={current}
                    onChange={(price) => setPriceDrafts((d) => ({ ...d, [id]: price }))}
                  />
                  <Button
                    variant="secondary"
                    label={t("common.save")}
                    onPress={() => {
                      if (!providerId) return;
                      if (!isPriceInRange(current, min, max)) {
                        setActionError(true);
                        return;
                      }
                      setPrice.mutate({ providerId, serviceId: id, price: current });
                    }}
                  />
                  {!isPriceInRange(current, min, max) ? (
                    <Text tone="danger" size="sm">
                      {t("pricePicker.outOfRange")}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </View>
          );
        })}
      </QueryState>
      <Button
        variant="secondary"
        label={t("providerSetup.titles.hours")}
        onPress={() => router.push({ pathname: "/pro-setup/[item]", params: { item: "hours" } })}
      />
      <ActionError error={actionError} />
    </Page>
  );
}
