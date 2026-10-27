import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, Share, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, BadgeCheck, Heart, Share2, Star } from "lucide-react-native";
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
import { useProviderAvailability } from "@/lib/provider/queries";
import { appConfig } from "@/lib/supabase";
import { localized, money } from "@/lib/presentation";
import { isFixedPackage, packageLabel } from "@shared/pricing/servicePackages";
import { workingHoursSummary } from "@shared/provider/workingHoursSummary";
import { levelRanges } from "@shared/tutoring/levelRanges";
import type { TeachingCapabilityOption } from "@shared/tutoring/teachingCapabilities";
import { Avatar } from "@/ui/ProviderCard";
import { Page, QueryState, ActionError, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { colors } from "@/ui/theme";
import { customerStyle } from "@/ui/customer/Primitives";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <Text size="lg" weight="heavy">
        {title}
      </Text>
      {children}
    </View>
  );
}

export default function ProviderProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const address = useDefaultAddress();
  const provider = useProvider(id, address.data?.id);
  const reviews = useProviderReviews(id);
  const services = useProviderServices(id);
  const bookable = useBookableServiceIds(id, address.data?.id);
  const caps = useApprovedTeachingCapabilities(id);
  const availability = useProviderAvailability(id);
  const favoriteIds = useFavoriteIds();
  const favorite = useToggleFavorite();
  const [shareError, setShareError] = useState(false);
  const p = provider.data;
  const liked = favoriteIds.data?.includes(id) ?? false;
  // Keep the native fail-closed loading/error guards. No new eligibility decisions.
  const available = (services.data ?? []).filter(
    (row) =>
      bookable.data?.has(row.service.id) &&
      (row.service.category?.slug !== "tutoring" ||
        caps.data?.some((cap) => cap.serviceId === row.service.id)),
  );
  const care = available.filter((row) => row.service.category?.slug !== "tutoring");
  const tutoringIds = new Set(
    available
      .filter((row) => row.service.category?.slug === "tutoring")
      .map((row) => row.service.id),
  );
  const grouped = new Map<string, TeachingCapabilityOption[]>();
  for (const cap of caps.data ?? []) {
    if (!tutoringIds.has(cap.serviceId)) continue;
    const key = [
      cap.serviceId,
      cap.subjectCode,
      cap.curriculumCode,
      cap.durationMin,
      cap.price,
    ].join("|");
    grouped.set(key, [...(grouped.get(key) ?? []), cap]);
  }
  const name = p?.profile.full_name || t("provider2.unnamed");
  const firstName = name.split(" ")[0];
  const bio = (ar ? p?.bio_ar : p?.bio_en) || p?.bio_en;
  const hours = workingHoursSummary(availability.data ?? [], t);
  const Back = ar ? ArrowRight : ArrowLeft;
  const iconStyle = {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "white",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  return (
    <Page
      title={name}
      queries={[provider, reviews, services, bookable, caps, availability, favoriteIds]}
      contentStyle={{ paddingTop: 8, gap: 16 }}
      header={
        <View
          style={[
            customerStyle.row,
            { justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12 },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            style={iconStyle}
            onPress={() => router.navigate("/home")}
          >
            <Back size={20} color={colors.foreground} />
          </Pressable>
          <View style={[customerStyle.row, { gap: 8 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.share")}
              style={iconStyle}
              onPress={() => {
                setShareError(false);
                void Share.share({
                  title: name,
                  message: `${appConfig.webOrigin}/provider/${encodeURIComponent(id)}`,
                  url: `${appConfig.webOrigin}/provider/${encodeURIComponent(id)}`,
                }).catch(() => setShareError(true));
              }}
            >
              <Share2 size={20} color={colors.foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(liked ? "mobile.unfavorite" : "mobile.favorite")}
              accessibilityState={{
                selected: liked,
                disabled: favorite.isPending || favoriteIds.isLoading || favoriteIds.isError,
              }}
              disabled={favorite.isPending || favoriteIds.isLoading || favoriteIds.isError}
              style={iconStyle}
              onPress={() => favorite.mutate({ providerId: id, on: !liked })}
            >
              <Heart
                size={20}
                color={liked ? colors.brand : colors.foreground}
                fill={liked ? colors.brand : "transparent"}
              />
            </Pressable>
          </View>
        </View>
      }
      footer={
        p && available.length ? (
          <View style={{ gap: 8 }}>
            <Text size="xs" tone="muted" style={{ textAlign: "center" }}>
              {t("providerProfile.freeCancel")}
            </Text>
            <Button
              label={t("providerProfile.bookWith", { name: firstName })}
              onPress={() =>
                router.push({ pathname: "/book/[providerId]", params: { providerId: id } })
              }
            />
          </View>
        ) : undefined
      }
    >
      <ActionError error={shareError || favorite.error} />
      <QueryState query={provider} empty={!p} emptyKey="provider2.notFound">
        {p ? (
          <>
            <View style={{ alignItems: "center", gap: 8 }}>
              <Avatar raw={p.profile.avatar_url} size={96} round />
              <Text size="xxl" weight="heavy" style={{ textAlign: "center", marginTop: 4 }}>
                {name}
              </Text>
              <Text tone="muted">
                {[...new Set(available.map((row) => row.service.category?.slug))]
                  .map((slug) => t(slug === "tutoring" ? "roles.teacher" : "roles.babysitter"))
                  .join(" · ")}
              </Text>
              <View style={[customerStyle.row, { justifyContent: "center", flexWrap: "wrap" }]}>
                {Number(p.ratings.rating_count) > 0 ? (
                  <View style={[customerStyle.row, { gap: 4 }]}>
                    <Star size={16} color={colors.warning} fill={colors.warning} />
                    <Text size="sm">{Number(p.ratings.rating_avg).toFixed(1)}</Text>
                    <Text size="sm" tone="muted">
                      ({t("providerPage.reviewCount", { count: Number(p.ratings.rating_count) })})
                    </Text>
                  </View>
                ) : (
                  <Text size="sm" tone="muted">
                    {t("providerPage.newOnFamy")}
                  </Text>
                )}
                {p.is_verified ? (
                  <View style={[customerStyle.row, { gap: 4 }]}>
                    <BadgeCheck size={16} color={colors.success} />
                    <Text size="sm" tone="success">
                      {t("providerPage.idVerified")}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View
              style={[
                customerStyle.card,
                customerStyle.row,
                { paddingVertical: 12, paddingHorizontal: 0 },
              ]}
            >
              {[
                [t("providerPage.completed"), String(p.ratings.rating_count ?? 0)],
                [
                  t("providerPage.experience"),
                  t("providerPage.years", { count: Number(p.years_experience) }),
                ],
                [t("providerPage.area"), p.city || "—"],
              ].map(([label, value], index) => (
                <View
                  key={label}
                  style={{
                    flex: 1,
                    paddingHorizontal: 8,
                    borderStartWidth: index ? 1 : 0,
                    borderStartColor: colors.border,
                  }}
                >
                  <Text size="xs" tone="muted" style={{ textAlign: "center" }}>
                    {label}
                  </Text>
                  <Text size="lg" weight="bold" style={{ textAlign: "center" }}>
                    {value}
                  </Text>
                </View>
              ))}
            </View>
            <QueryState
              query={{
                isLoading: services.isLoading || bookable.isLoading || caps.isLoading,
                isError: services.isError || bookable.isError || caps.isError,
                refetch: () =>
                  Promise.all([services.refetch(), bookable.refetch(), caps.refetch()]),
              }}
            >
              {care.length ? (
                <Section title={t("providerPage.services")}>
                  {care.map((row) => {
                    const s = row.service;
                    const fixed = isFixedPackage(s);
                    const effective = bookable.data?.get(s.id);
                    const rate = fixed
                      ? (row.price_override ?? effective)
                      : (effective ?? row.price_override ?? p.hourly_rate);
                    const pack = fixed ? packageLabel(s) : null;
                    return (
                      <View
                        key={s.id}
                        style={[
                          customerStyle.row,
                          {
                            justifyContent: "space-between",
                            paddingVertical: 12,
                            borderBottomWidth: 1,
                            borderBottomColor: colors.border,
                          },
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text weight="bold">{localized(s, i18n.language)}</Text>
                          <Text size="xs" tone="muted">
                            {pack
                              ? t(
                                  pack.key === "packages.fullDay"
                                    ? "providerPage.fullDayHint"
                                    : pack.key === "packages.overnight"
                                      ? "providerPage.overnightHint"
                                      : pack.key,
                                  pack.values,
                                )
                              : t("providerPage.hourlyHint")}
                          </Text>
                        </View>
                        {rate == null ? null : (
                          <Text weight="bold" tone="brand">
                            {fixed
                              ? money(rate, i18n.language)
                              : t("providerPage.perHour", { price: money(rate, i18n.language) })}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </Section>
              ) : null}
              {grouped.size ? (
                <Section title={t("providerPage.teaches")}>
                  {[...grouped].map(([key, rows]) => {
                    const c = rows[0];
                    const ranges = levelRanges(
                      rows.map((row) => ({
                        code: row.levelCode,
                        name: ar ? row.levelNameAr : row.levelNameEn,
                      })),
                    );
                    return (
                      <View
                        key={key}
                        style={{
                          borderRadius: 16,
                          padding: 14,
                          backgroundColor: colors.surface2,
                          gap: 4,
                        }}
                      >
                        <Text weight="bold">
                          {ar ? c.subjectNameAr : c.subjectNameEn} ·{" "}
                          {ar ? c.curriculumNameAr : c.curriculumNameEn}
                        </Text>
                        <Text size="sm" tone="muted">
                          {ranges
                            .map((range) =>
                              range.to ? t("providerPage.levelRange", range) : range.from,
                            )
                            .join("، ")}
                        </Text>
                        <Text size="sm" weight="bold" tone="brand">
                          {t("providerPage.session", {
                            price: money(c.price, i18n.language),
                            minutes: String(c.durationMin),
                          })}
                        </Text>
                      </View>
                    );
                  })}
                </Section>
              ) : null}
              {!available.length ? (
                <View style={{ borderRadius: 16, padding: 16, backgroundColor: colors.surface2 }}>
                  <Text tone="muted" style={{ textAlign: "center" }}>
                    {t("providerPage.notBookable", { name: firstName })}
                  </Text>
                </View>
              ) : null}
            </QueryState>
            {bio ? (
              <Section title={t("providerPage.about", { name: firstName })}>
                <Text style={{ lineHeight: 23 }}>{bio}</Text>
                {p.languages?.length ? (
                  <Text size="sm" tone="muted">
                    {t("providerPage.languages")}:{" "}
                    {p.languages
                      .map((code) =>
                        code === "ar"
                          ? t("common.arabic")
                          : code === "en"
                            ? t("common.english")
                            : code,
                      )
                      .join("، ")}
                  </Text>
                ) : null}
              </Section>
            ) : null}
            <Section title={t("providerPage.hours")}>
              <QueryState query={availability}>
                {hours.length ? (
                  hours.map((line) => <Text key={line}>{line}</Text>)
                ) : (
                  <Text tone="muted">{t("providerPage.noHours")}</Text>
                )}
              </QueryState>
              <Text size="xs" tone="muted">
                {t("providerPage.hoursHint")}
              </Text>
            </Section>
            <Section
              title={t(
                reviews.data?.length
                  ? "providerPage.reviewsTitle"
                  : "providerPage.reviewsTitleEmpty",
                { count: reviews.data?.length ?? 0 },
              )}
            >
              <QueryState query={reviews}>
                {!reviews.data?.length ? (
                  <Text tone="muted">{t("providerPage.noReviews")}</Text>
                ) : (
                  reviews.data.slice(0, 5).map((r) => (
                    <View
                      key={r.id}
                      style={{
                        paddingVertical: 12,
                        gap: 8,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                      }}
                    >
                      <View style={customerStyle.row}>
                        <View style={{ flex: 1 }}>
                          <Text size="xs" tone="muted">
                            {new Date(r.created_at).toLocaleDateString(
                              ar ? "ar-EG-u-nu-latn" : "en-EG",
                              { day: "numeric", month: "long", year: "numeric" },
                            )}
                          </Text>
                        </View>
                        <Star size={16} color={colors.warning} fill={colors.warning} />
                        <Text size="sm" weight="bold">
                          {String(r.rating)}
                        </Text>
                      </View>
                      {r.comment ? <Text>{r.comment}</Text> : null}
                    </View>
                  ))
                )}
              </QueryState>
            </Section>
          </>
        ) : null}
      </QueryState>
    </Page>
  );
}
