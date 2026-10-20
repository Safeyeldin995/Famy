import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { BadgeCheck } from "lucide-react-native";
import {
  useDefaultAddress,
  useProvider,
  useProviderReviews,
  useProviderServices,
  useBookableServiceIds,
  useApprovedTeachingCapabilities,
  useFavoriteIds,
  useToggleFavorite,
} from "@/lib/queries";
import { dateTime, localized, money } from "@/lib/presentation";
import { isFixedPackage, packageLabel } from "@shared/pricing/servicePackages";
import { Avatar } from "@/ui/ProviderCard";
import { Page, QueryState, ActionError, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { colors } from "@/ui/theme";

export default function ProviderProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const address = useDefaultAddress();
  const provider = useProvider(id, address.data?.id);
  const reviews = useProviderReviews(id);
  const services = useProviderServices(id);
  const bookable = useBookableServiceIds(id, address.data?.id);
  const caps = useApprovedTeachingCapabilities(id);
  const favoriteIds = useFavoriteIds();
  const favorite = useToggleFavorite();
  const p = provider.data;
  const liked = favoriteIds.data?.includes(id) ?? false;
  const available = (services.data ?? []).filter(
    (s) =>
      bookable.data?.has(s.service.id) &&
      (s.service.category?.slug !== "tutoring" ||
        caps.data?.some((c) => c.serviceId === s.service.id)),
  );
  return (
    <Page
      title={p?.profile.full_name || t("mobile.provider")}
      queries={[provider, reviews, services, bookable, caps, favoriteIds]}
    >
      <QueryState query={provider} empty={!p} emptyKey="provider2.notFound">
        {p && (
          <>
            <View style={ui.card}>
              <Avatar raw={p.profile.avatar_url} size={100} />
              <Text size="title" weight="heavy">
                {p.profile.full_name || t("provider2.unnamed")}
              </Text>
              {p.is_verified && (
                <View style={ui.wrap}>
                  <BadgeCheck color={colors.success} size={20} />
                  <Text tone="success">{t("mobile.verified")}</Text>
                </View>
              )}
              <Text style={ui.ltr}>
                {Number(p.ratings.rating_count) > 0
                  ? t("mobile.rating", {
                      rating: Number(p.ratings.rating_avg).toFixed(1),
                      count: p.ratings.rating_count,
                    })
                  : t("mobile.noReviews")}
              </Text>
              <QueryState query={favoriteIds}>
                <Button
                  variant="secondary"
                  label={t(liked ? "mobile.unfavorite" : "mobile.favorite")}
                  loading={favorite.isPending}
                  onPress={() => favorite.mutate({ providerId: id, on: !liked })}
                />
              </QueryState>
              <ActionError error={favorite.error} />
              <Text>
                {(i18n.language === "ar" ? p.bio_ar : p.bio_en) || p.bio_en || t("mobile.noBio")}
              </Text>
            </View>
            <Text size="xl" weight="heavy">
              {t("mobile.servicesPrices")}
            </Text>
            <QueryState
              query={{
                isLoading: services.isLoading || bookable.isLoading || caps.isLoading,
                isError: services.isError || bookable.isError || caps.isError,
                refetch: () =>
                  Promise.all([services.refetch(), bookable.refetch(), caps.refetch()]),
              }}
              empty={!available.length}
            >
              {available.map((row) => {
                const s = row.service;
                const fixed = isFixedPackage(s);
                const effective = bookable.data?.get(s.id);
                const rate = fixed
                  ? (row.price_override ?? effective)
                  : (effective ?? row.price_override ?? p.hourly_rate);
                return (
                  <View key={s.id} style={ui.card}>
                    <Text weight="heavy">{localized(s, i18n.language)}</Text>
                    {s.category?.slug === "tutoring" ? (
                      (caps.data ?? [])
                        .filter((c) => c.serviceId === s.id)
                        .map((c) => (
                          <View key={c.id}>
                            <Text>
                              {[
                                i18n.language === "ar" ? c.subjectNameAr : c.subjectNameEn,
                                i18n.language === "ar" ? c.curriculumNameAr : c.curriculumNameEn,
                                i18n.language === "ar" ? c.levelNameAr : c.levelNameEn,
                              ].join(" · ")}
                            </Text>
                            <Text style={ui.ltr}>
                              {t("mobile.sessionPrice", {
                                price: money(c.price, i18n.language),
                                minutes: c.durationMin,
                              })}
                            </Text>
                          </View>
                        ))
                    ) : (
                      <>
                        <Text style={ui.ltr}>
                          {rate == null
                            ? t("mobile.priceUnavailable")
                            : fixed
                              ? money(rate, i18n.language)
                              : t("providerPage.perHour", { price: money(rate, i18n.language) })}
                        </Text>
                        {fixed && <Text>{t(packageLabel(s).key, packageLabel(s).values)}</Text>}
                      </>
                    )}
                  </View>
                );
              })}
            </QueryState>
            <Button
              label={t("mobile.book")}
              disabled={!available.length}
              onPress={() => router.push("/booking-coming-soon")}
            />
            <Text size="xl" weight="heavy">
              {t("mobile.reviews")}
            </Text>
            <QueryState query={reviews} empty={!reviews.data?.length} emptyKey="mobile.noReviews">
              {reviews.data?.map((r) => (
                <View key={r.id} style={ui.card}>
                  <Text style={ui.ltr}>{t("mobile.reviewRating", { rating: r.rating })}</Text>
                  {r.comment && <Text>{r.comment}</Text>}
                  <Text tone="muted" size="sm">
                    {dateTime(r.created_at, i18n.language)}
                  </Text>
                </View>
              ))}
            </QueryState>
          </>
        )}
      </QueryState>
    </Page>
  );
}
