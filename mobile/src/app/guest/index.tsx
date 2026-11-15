import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useActiveZones } from "@/lib/bookingQueries";
import { useGuestProviders } from "@/lib/queries";
import { getGuestZone, setGuestZone } from "@/lib/guest";
import { localized } from "@/lib/presentation";
import { Page, QueryState, Choices } from "@/ui/Page";
import { ProviderCard } from "@/ui/ProviderCard";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { space } from "@/ui/theme";

/** Browse providers without an account: pick an area, then see who covers it. */
export default function GuestHome() {
  const { t, i18n } = useTranslation();
  const zones = useActiveZones();
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const providers = useGuestProviders(zoneId);

  useEffect(() => {
    let cancelled = false;
    void getGuestZone().then((saved) => {
      if (cancelled) return;
      if (saved) setZoneId(saved);
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Drop a saved area that is no longer active.
  useEffect(() => {
    if (!restored || !zoneId || !zones.data) return;
    if (!zones.data.some((z) => z.id === zoneId)) setZoneId(null);
  }, [restored, zoneId, zones.data]);

  const choose = (id: string) => {
    setZoneId(id);
    void setGuestZone(id);
  };

  const list = providers.data ?? [];

  return (
    <Page
      title={t("guest.title")}
      queries={zoneId ? [zones, providers] : [zones]}
      footer={<Button label={t("guest.signIn")} onPress={() => router.replace("/login")} />}
    >
      <View style={{ gap: space.xs }}>
        <Text size="lg" weight="heavy">
          {t("guest.pickArea")}
        </Text>
        <Text tone="muted">{t("guest.pickAreaHint")}</Text>
      </View>
      <QueryState query={zones} empty={!zones.data?.length}>
        <Choices
          label={t("guest.area")}
          value={zoneId ?? ""}
          onChange={choose}
          options={(zones.data ?? []).map((z) => ({
            value: z.id,
            label: localized(z, i18n.language),
          }))}
        />
      </QueryState>
      {zoneId ? (
        <View style={{ gap: space.md }}>
          <Text size="lg" weight="heavy">
            {t("guest.providersTitle")}
          </Text>
          <QueryState query={providers} empty={!list.length} emptyKey="guest.empty">
            {list.map((p) => {
              const serviceId = p.services[0]?.service.id;
              return (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  onPress={() =>
                    router.push({
                      pathname: "/guest/provider/[id]",
                      params: serviceId ? { id: p.id, serviceId } : { id: p.id },
                    })
                  }
                />
              );
            })}
          </QueryState>
        </View>
      ) : null}
    </Page>
  );
}
