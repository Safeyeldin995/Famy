import { View, Pressable } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { UserRound, ShieldCheck, Star } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useAvatarUrl, type Provider } from "@/lib/queries";
import { localized } from "@/lib/presentation";
import { customerMoney, customerNumber } from "@/lib/customerFormat";
import { isFixedPackage, packageLabel } from "@shared/pricing/servicePackages";
import { Text } from "./Text";
import { colors, radius, space } from "./theme";
import { ui } from "./Page";

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
        />
      ) : name ? (
        <Text weight="bold" style={{ fontSize: Math.min(24, size / 2), color: colors.brand }}>
          {name.trim().slice(0, 1)}
        </Text>
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
      <Avatar
        raw={p.profile.avatar_url}
        name={p.profile.full_name || t("provider2.unnamed")}
        size={56}
        round
      />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
        <View style={[ui.wrap, { gap: 4, marginTop: 4 }]}>
          {Number(p.ratings.rating_count) > 0 ? (
            <Star size={14} color={colors.warning} fill={colors.warning} />
          ) : null}
          <Text size="xs" tone="muted">
            {Number(p.ratings.rating_count) > 0
              ? `${customerNumber(Number(p.ratings.rating_avg), i18n.language)} (${customerNumber(Number(p.ratings.rating_count), i18n.language)})`
              : t("providerPage.newOnFamy")}
          </Text>
        </View>
        {subtitle ? (
          <Text weight="bold" style={{ marginTop: 4 }}>
            {subtitle}
          </Text>
        ) : (
          p.hourly_rate != null && (
            <Text weight="bold" style={{ marginTop: 4 }}>
              {packageInfo
                ? `${customerMoney(p.hourly_rate, i18n.language)} · ${t(packageInfo.key, packageInfo.values)}`
                : customerMoney(p.hourly_rate, i18n.language, true)}
            </Text>
          )
        )}
      </View>
    </Pressable>
  );
}
