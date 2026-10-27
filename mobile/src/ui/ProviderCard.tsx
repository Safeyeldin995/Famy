import { View, Pressable } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { UserRound, BadgeCheck, Star } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useAvatarUrl, type Provider } from "@/lib/queries";
import { localized, money } from "@/lib/presentation";
import { isFixedPackage, packageLabel } from "@shared/pricing/servicePackages";
import { Text } from "./Text";
import { colors, radius, space } from "./theme";
import { ui } from "./Page";

export function Avatar({
  raw,
  size = 64,
  round = false,
}: {
  raw?: string | null;
  size?: number;
  round?: boolean;
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
        />
      ) : (
        <UserRound size={size / 2} color={colors.brand} />
      )}
    </View>
  );
}
export function ProviderCard({ provider: p, subtitle }: { provider: Provider; subtitle?: string }) {
  const { t, i18n } = useTranslation();
  const service = p.services[0]?.service;
  const packageInfo = service && isFixedPackage(service) ? packageLabel(service) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.profile.full_name || t("provider2.unnamed")}
      onPress={() => router.push({ pathname: "/provider/[id]", params: { id: p.id } })}
      style={({ pressed }) => [
        ui.card,
        {
          flexDirection: "row",
          gap: 12,
          padding: 16,
          borderRadius: 16,
          backgroundColor: "white",
          shadowOpacity: 0,
          elevation: 0,
        },
        pressed && ui.pressed,
      ]}
    >
      <Avatar raw={p.profile.avatar_url} size={56} round />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text size="lg" weight="bold" style={{ flexShrink: 1 }}>
            {p.profile.full_name || t("provider2.unnamed")}
          </Text>
          {p.is_verified && (
            <BadgeCheck
              size={16}
              color={colors.success}
              accessibilityLabel={t("common.verified")}
            />
          )}
        </View>
        <Text size="sm" tone="muted">
          {[...new Set(p.services.map((item) => item.service?.category?.slug))]
            .map((slug) =>
              slug === "babysitting"
                ? t("roles.babysitter")
                : slug === "tutoring"
                  ? t("roles.teacher")
                  : "",
            )
            .filter(Boolean)
            .join(" · ") || localized(service, i18n.language)}
        </Text>
        <View style={ui.wrap}>
          <Star size={16} color={colors.warning} />
          <Text size="xs" tone="muted" style={ui.ltr}>
            {Number(p.ratings.rating_count) > 0
              ? t("mobile.rating", {
                  rating: Number(p.ratings.rating_avg).toFixed(1),
                  count: p.ratings.rating_count,
                })
              : t("mobile.noReviews")}
          </Text>
        </View>
        {subtitle ? (
          <Text size="sm" tone="muted">
            {subtitle}
          </Text>
        ) : (
          p.hourly_rate != null && (
            <Text weight="bold" style={[ui.ltr, { marginTop: 4 }]}>
              {packageInfo
                ? `${money(p.hourly_rate, i18n.language)} · ${t(packageInfo.key, packageInfo.values)}`
                : t("providerPage.perHour", { price: money(p.hourly_rate, i18n.language) })}
            </Text>
          )
        )}
      </View>
    </Pressable>
  );
}
