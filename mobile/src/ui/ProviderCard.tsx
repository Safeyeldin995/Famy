import { View, Pressable } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { UserRound, ShieldCheck, Star } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useAvatarUrl, type Provider } from "@/lib/queries";
import { localized } from "@/lib/presentation";
import { customerMoney } from "@/lib/customerFormat";
import { providerRatingSummary } from "@/lib/providerRating";
import { joinUiParts, uiListSeparator } from "@shared/format/uiJoin";
import { isFixedPackage, packageLabel } from "@shared/pricing/servicePackages";
import { Text } from "./Text";
import { colors, fontSizeTokenForAvatarInitial, radius, space } from "./theme";
import { ui } from "./Page";
import { isTutoringCategorySlug } from "@shared/tutoring/teachingCapabilities";

export function Avatar({
  raw,
  size = 64,
  round = false,
  name,
}: {
  raw?: string | null;
  size?: number;
  round?: boolean;
  name?: string;
}) {
  const image = useAvatarUrl(raw);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: round ? size / 2 : radius.lg,
        backgroundColor: colors.brandTint,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {image.data ? (
        <Image
          source={{ uri: image.data }}
          style={{ width: size, height: size }}
          contentFit="cover"
          accessibilityLabel={name?.trim() ? name : undefined}
        />
      ) : name ? (
        <Text size={fontSizeTokenForAvatarInitial(size)} weight="bold" tone="brand">
          {name.trim().slice(0, 1)}
        </Text>
      ) : (
        <UserRound size={size / 2} color={colors.brand} />
      )}
    </View>
  );
}
export function ProviderCard({
  provider: p,
  subtitle,
  onPress,
}: {
  provider: Provider;
  subtitle?: string;
  /** Overrides the default navigation (guest browsing opens the guest profile). */
  onPress?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const service = p.services[0]?.service;
  const packageInfo = service && isFixedPackage(service) ? packageLabel(service) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.profile.full_name || t("provider2.unnamed")}
      onPress={
        onPress ??
        (() =>
          router.push({
            pathname: "/provider/[id]",
            params: service?.id ? { id: p.id, serviceId: service.id } : { id: p.id },
          }))
      }
      style={({ pressed }) => [
        ui.card,
        {
          flexDirection: "row",
          gap: space.md,
          padding: space.lg,
          borderRadius: radius.xl,
        },
        pressed && ui.pressed,
      ]}
    >
      <Avatar
        raw={p.profile.avatar_url}
        name={p.profile.full_name || t("provider2.unnamed")}
        size={48}
        round
      />
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text size="lg" weight="bold" style={{ flexShrink: 1 }}>
            {p.profile.full_name || t("provider2.unnamed")}
          </Text>
          {p.is_verified && (
            <ShieldCheck
              size={16}
              color={colors.success}
              accessibilityLabel={t("common.verified")}
            />
          )}
        </View>
        <Text size="sm" tone="muted">
          {[
            ...new Set(
              p.services.map((item) => {
                const slug = item.service?.category?.slug;
                return slug === "babysitting"
                  ? t("roles.babysitter")
                  : isTutoringCategorySlug(slug)
                    ? t("roles.teacher")
                    : "";
              }),
            ),
          ]
            .filter(Boolean)
            .join(uiListSeparator(i18n.language)) || localized(service, i18n.language)}
        </Text>
        <View style={[ui.wrap, { gap: space.xs, marginTop: space.xs }]}>
          {Number(p.ratings.rating_count) > 0 ? (
            <Star size={14} color={colors.warning} fill={colors.warning} />
          ) : null}
          <Text size="xs" tone="muted">
            {Number(p.ratings.rating_count) > 0
              ? providerRatingSummary(
                  Number(p.ratings.rating_avg),
                  t("providerPage.reviewCount", { count: Number(p.ratings.rating_count) }),
                  i18n.language,
                )
              : t("providerPage.newOnFamy")}
          </Text>
        </View>
        {subtitle ? (
          <Text weight="bold" style={{ marginTop: space.xs }}>
            {subtitle}
          </Text>
        ) : (
          p.hourly_rate != null && (
            <Text weight="bold" style={{ marginTop: space.xs }}>
              {packageInfo
                ? joinUiParts(
                    [customerMoney(p.hourly_rate, i18n.language), t(packageInfo.key, packageInfo.values)],
                    i18n.language,
                  )
                : isTutoringCategorySlug(service?.category?.slug)
                  ? t("providerPage.perSession", {
                      price: customerMoney(p.hourly_rate, i18n.language),
                    })
                  : customerMoney(p.hourly_rate, i18n.language, true)}
            </Text>
          )
        )}
      </View>
    </Pressable>
  );
}
