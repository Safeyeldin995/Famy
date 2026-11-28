import { useEffect, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react-native";
import { useGuestProvider } from "@/lib/queries";
import { ProviderTrustBadges, PublicProviderReviews } from "@/ui/provider/ProviderTrust";
import { getGuestZone, saveGuestIntent } from "@/lib/guest";
import { localized, money } from "@/lib/presentation";
import { providerRatingSummary } from "@/lib/providerRating";
import { isFixedPackage } from "@shared/pricing/servicePackages";
import { Avatar } from "@/ui/ProviderCard";
import { Page, QueryState } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { customerStyle } from "@/ui/customer/Primitives";

/** Public provider profile for guests. Booking needs an account; we resume here after sign-up. */
export default function GuestProvider() {
  const { id, serviceId, zone } = useLocalSearchParams<{
    id: string;
    serviceId?: string;
    zone?: string;
  }>();
  const { t, i18n } = useTranslation();
  const ar = i18n.language === "ar";
  // The list passes the area; a deep link falls back to the saved one.
  const [storedZone, setStoredZone] = useState<string | null>(null);
  const [zoneReady, setZoneReady] = useState(!!zone);
  const zoneId = zone || storedZone;
  const detail = useGuestProvider(id, zoneId);

  useEffect(() => {
    if (zone) return;
    let cancelled = false;
    void getGuestZone().then((saved) => {
      if (cancelled) return;
      setStoredZone(saved);
      setZoneReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [zone]);

  // Until the area is known the query is idle; show loading, not "unavailable".
  const detailState =
    zoneReady && zoneId ? detail : { ...detail, isPending: !zoneReady, isLoading: !zoneReady };

  const p = detail.data?.provider;
  const name = p?.profile.full_name || t("provider2.unnamed");
  const bio = (ar ? p?.bio_ar : p?.bio_en) || p?.bio_en;
  const serviceSlugs = (detail.data?.services ?? []).map(({ service }) => service.category?.slug);
  const onlyTutoring = serviceSlugs.length > 0 && serviceSlugs.every((slug) => slug === "tutoring");

  const book = async () => {
    if (id) await saveGuestIntent(id, serviceId);
    router.dismissTo("/login");
  };

  return (
    <Page
      title={p ? name : t("guest.title")}
      queries={[detail]}
      footer={
        p ? (
          <View style={{ gap: space.xs }}>
            <Button label={t("guest.bookCta")} onPress={() => void book()} />
            <Text size="xs" tone="muted" style={{ textAlign: "center" }}>
              {t("guest.bookHint")}
            </Text>
          </View>
        ) : null
      }
    >
      <QueryState query={detailState} empty={!p} emptyKey="guest.unavailable">
        {p ? (
          <>
            <View style={{ alignItems: "center", gap: space.sm }}>
              <Avatar raw={p.profile.avatar_url} size={96} round name={name} />
              <Text size="xxl" weight="heavy" style={{ textAlign: "center" }}>
                {name}
              </Text>
              <View style={[customerStyle.row, { justifyContent: "center", flexWrap: "wrap" }]}>
                {Number(p.ratings.rating_count) > 0 ? (
                  <View style={[customerStyle.row, { gap: space.xs }]}>
                    <Star size={16} color={colors.warning} fill={colors.warning} />
                    <Text size="sm">
                      {providerRatingSummary(
                        Number(p.ratings.rating_avg),
                        t("providerPage.reviewCount", { count: Number(p.ratings.rating_count) }),
                        i18n.language,
                      )}
                    </Text>
                  </View>
                ) : (
                  <Text size="sm" tone="muted">
                    {t("providerPage.newOnFamy")}
                  </Text>
                )}
              </View>
            </View>

            <ProviderTrustBadges
              providerId={id}
              tutoring={onlyTutoring}
              verifiedFallback={p.is_verified}
            />

            {bio ? (
              <View style={{ gap: space.sm }}>
                <Text size="lg" weight="heavy">
                  {t("guest.about")}
                </Text>
                <Text>{bio}</Text>
              </View>
            ) : null}

            <View style={{ gap: space.sm }}>
              <Text size="lg" weight="heavy">
                {t("guest.services")}
              </Text>
              {detail.data!.services.map(({ service, price }) => (
                <View
                  key={service.id}
                  style={[
                    customerStyle.row,
                    {
                      justifyContent: "space-between",
                      paddingVertical: space.md,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <Text weight="bold" style={{ flex: 1 }}>
                    {localized(service, i18n.language)}
                  </Text>
                  {price == null ? null : (
                    <Text weight="bold" tone="brand">
                      {isFixedPackage(service)
                        ? money(price, i18n.language)
                        : service.category?.slug === "tutoring"
                          ? t("providerPage.perSession", { price: money(price, i18n.language) })
                          : t("providerPage.perHour", { price: money(price, i18n.language) })}
                    </Text>
                  )}
                </View>
              ))}
            </View>

            <View style={{ gap: space.sm }}>
              <Text size="lg" weight="heavy">
                {t("guest.reviews")}
              </Text>
              <PublicProviderReviews providerId={id} />
            </View>
          </>
        ) : null}
      </QueryState>
    </Page>
  );
}
