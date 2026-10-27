import { Image, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { BookingRequestActions } from "./BookingRequestActions";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { localized, money } from "@/lib/presentation";
import type { BookingParty } from "@/lib/provider/parties";

export type ProviderCardBooking = {
  id: string;
  start_at: string;
  status?: string;
  price_total?: number | null;
  customer?: { full_name?: string | null; avatar_url?: string | null } | null;
  service?: { name_ar?: string | null; name_en?: string | null } | null;
  party?: BookingParty;
};

function bookingTime(value: string, language: string) {
  const date = new Date(value);
  const locale = language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";
  const options = { timeZone: "Africa/Cairo" };
  return `${new Intl.DateTimeFormat(locale, { ...options, day: "numeric", month: "long" }).format(date)} · ${new Intl.DateTimeFormat(locale, { ...options, hour: "numeric", minute: "2-digit" }).format(date)}`;
}

export function ProviderBookingCard({
  booking,
  request = false,
}: {
  booking: ProviderCardBooking;
  request?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const name = booking.customer?.full_name || t("pro.common.customer");
  const area = language.startsWith("ar")
    ? booking.party?.zone_name_ar || booking.party?.area
    : booking.party?.zone_name_en || booking.party?.area;
  const child = booking.party?.member_first_name;
  const age = booking.party?.member_age_years;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.xl,
        backgroundColor: colors.surface,
        overflow: "hidden",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${localized(booking.service, language)}`}
        onPress={() => router.push({ pathname: "/pro-booking/[id]", params: { id: booking.id } })}
        style={{ padding: space.md, gap: space.sm }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          {booking.customer?.avatar_url ? (
            <Image
              source={{ uri: booking.customer.avatar_url }}
              style={{ width: 48, height: 48, borderRadius: 14 }}
            />
          ) : (
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                backgroundColor: colors.brandTint,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text weight="heavy" tone="brand">
                {name.trim().slice(0, 1)}
              </Text>
            </View>
          )}
          <Text weight="heavy" size="lg" style={{ flex: 1 }} numberOfLines={1}>
            {name}
          </Text>
          <Text weight="heavy" size="lg" tone="brand" style={{ writingDirection: "ltr" }}>
            {money(Number(booking.price_total ?? 0), language)}
          </Text>
        </View>
        <Text weight="bold">{localized(booking.service, language)}</Text>
        {area || child ? (
          <Text tone="muted" size="sm">
            {[
              area,
              child
                ? age != null
                  ? t("pro.booking.childWithAge", { name: child, count: age })
                  : child
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}
        <Text tone="muted" size="sm">
          {bookingTime(booking.start_at, language)}
        </Text>
      </Pressable>
      {request ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingHorizontal: space.md,
            paddingBottom: space.md,
          }}
        >
          <BookingRequestActions id={booking.id} />
        </View>
      ) : null}
    </View>
  );
}
