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

export function Avatar({ raw, size = 64 }: { raw?: string | null; size?: number }) {
  const image = useAvatarUrl(raw);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.lg,
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
export function ProviderCard({ provider: p }: { provider: Provider }) {
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
        { flexDirection: "row", gap: space.lg },
        pressed && ui.pressed,
      ]}
    >
      <Avatar raw={p.profile.avatar_url} size={72} />
      <View style={{ flex: 1, minWidth: 0, gap: space.sm }}>
        <Text size="lg" weight="heavy">
          {p.profile.full_name || t("provider2.unnamed")}
        </Text>
        {p.is_verified && (
          <View style={ui.wrap}>
            <BadgeCheck size={16} color={colors.success} />
            <Text size="sm" tone="success">
              {t("mobile.verified")}
            </Text>
          </View>
        )}
        <Text tone="muted">{localized(service, i18n.language)}</Text>
        <View style={ui.wrap}>
          <Star size={16} color={colors.warning} />
          <Text style={ui.ltr}>
            {Number(p.ratings.rating_count) > 0
              ? t("mobile.rating", {
                  rating: Number(p.ratings.rating_avg).toFixed(1),
                  count: p.ratings.rating_count,
                })
              : t("mobile.noReviews")}
          </Text>
        </View>
        {p.hourly_rate != null && (
          <Text weight="bold" tone="brand" style={ui.ltr}>
            {packageInfo
              ? `${money(p.hourly_rate, i18n.language)} · ${t(packageInfo.key, packageInfo.values)}`
              : t("providerPage.perHour", { price: money(p.hourly_rate, i18n.language) })}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
