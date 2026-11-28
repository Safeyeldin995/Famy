import { useEffect, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Star } from "lucide-react-native";
import { useGuestProvider, useProviderReviews } from "@/lib/queries";
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
import { ProviderCredentialsSection } from "@/ui/provider/ProviderCredentialsSection";
import { isTutoringCategorySlug } from "@shared/tutoring/teachingCapabilities";

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
  const reviews = useProviderReviews(id);

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
  const comments = (reviews.data ?? []).filter((r) => r.comment?.trim()).slice(0, 3);

  const book = async () => {
    if (id) await saveGuestIntent(id, serviceId);
    router.dismissTo("/login");
  };

  return (
    <Page
      title={p ? name : t("guest.title")}
      queries={[detail, reviews]}
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
                {p.is_verified ? (
                  <View style={[customerStyle.row, { gap: space.xs }]}>
                    <BadgeCheck size={16} color={colors.success} />
                    <Text size="sm" tone="success">
                      {t("providerPage.idVerified")}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

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
                        : isTutoringCategorySlug(service.category?.slug)
                          ? t("providerPage.perSession", { price: money(price, i18n.language) })
                          : t("providerPage.perHour", { price: money(price, i18n.language) })}
                    </Text>
                  )}
                </View>
              ))}
            </View>

            <ProviderCredentialsSection providerId={id} />

            {comments.length ? (
              <View style={{ gap: space.sm }}>
                <Text size="lg" weight="heavy">
                  {t("guest.reviews")}
                </Text>
                {comments.map((r) => (
                  <View
                    key={r.id}
                    style={{
                      gap: space.xs,
                      padding: space.md,
                      borderRadius: radius.lg,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <View style={[customerStyle.row, { gap: space.xs }]}>
                      <Star size={14} color={colors.warning} fill={colors.warning} />
                      <Text size="sm" weight="bold">
                        {r.rating}
                      </Text>
                    </View>
                    <Text size="sm">{r.comment}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </QueryState>
    </Page>
  );
}
