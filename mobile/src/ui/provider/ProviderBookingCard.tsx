import { Pressable, View } from "react-native";
import { bookingMemberAgeTranslation } from "@shared/familyMemberAge";
import { router } from "expo-router";
import { Avatar } from "../ProviderCard";
import { useTranslation } from "react-i18next";
import { BookingRequestActions } from "./BookingRequestActions";
import { Text } from "@/ui/Text";
import { moneyTextStyle } from "@/ui/Page";
import { colors, radius, space } from "@/ui/theme";
import { localized, money } from "@/lib/presentation";
import { joinUiParts } from "@shared/format/uiJoin";
import type { BookingParty } from "@/lib/provider/parties";
import {
  isSupervisionMode,
  supervisionModeProviderLabel,
} from "@shared/booking/supervisionMode";
import {
  providerHomeActiveBookingNeedsAction,
  providerHomeActiveBookingNextStepKey,
  providerHomeActiveBookingStatusKey,
} from "@shared/home/activeHomeBookings";

export type ProviderCardBooking = {
  id: string;
  start_at: string;
  end_at?: string;
  session_started_at?: string | null;
  arrival_confirmed_at?: string | null;
  status?: string;
  price_total?: number | null;
  supervision_mode?: string | null;
  customer?: { full_name?: string | null; avatar_url?: string | null } | null;
  service?: { name_ar?: string | null; name_en?: string | null } | null;
  party?: BookingParty;
};

function bookingTime(value: string, language: string) {
  const date = new Date(value);
  const locale = language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";
  const options = { timeZone: "Africa/Cairo" };
  return joinUiParts(
    [
      new Intl.DateTimeFormat(locale, { ...options, day: "numeric", month: "long" }).format(date),
      new Intl.DateTimeFormat(locale, { ...options, hour: "numeric", minute: "2-digit" }).format(
        date,
      ),
    ],
    language,
  );
}

export function ProviderBookingCard({
  booking,
  request = false,
  emphasize = false,
}: {
  booking: ProviderCardBooking;
  request?: boolean;
  emphasize?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const name = booking.customer?.full_name || t("pro.common.customer");
  const area = language.startsWith("ar")
    ? booking.party?.zone_name_ar || booking.party?.area
    : booking.party?.zone_name_en || booking.party?.area;
  const child = booking.party?.member_first_name;
  const age = bookingMemberAgeTranslation(booking.party);
  const status = String(booking.status ?? "");
  const statusKey = providerHomeActiveBookingStatusKey(status);
  const nextStepKey = providerHomeActiveBookingNextStepKey(status);
  const showEmphasis = emphasize && (statusKey || nextStepKey);
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
          <Avatar raw={booking.customer?.avatar_url} size={48} name={name} />
          <Text weight="heavy" size="lg" style={{ flex: 1 }} numberOfLines={1}>
            {name}
          </Text>
          <Text weight="heavy" size="lg" tone="brand" style={moneyTextStyle(language)}>
            {money(Number(booking.price_total ?? 0), language)}
          </Text>
        </View>
        <Text weight="bold">{localized(booking.service, language)}</Text>
        {area || child || isSupervisionMode(booking.supervision_mode) ? (
          <Text tone="muted" size="sm">
            {joinUiParts(
              [
                area,
                child ? joinUiParts([child, t(age.key, { count: age.count })], language) : "",
                supervisionModeProviderLabel(booking.supervision_mode, t) ?? "",
              ].filter((part): part is string => Boolean(part)),
              language,
            )}
          </Text>
        ) : null}
        <Text tone="muted" size="sm">
          {bookingTime(booking.start_at, language)}
        </Text>
        {showEmphasis ? (
          <View style={{ gap: space.xs, marginTop: space.xs }}>
            {statusKey ? (
              <Text
                size="xs"
                weight="bold"
                tone="brand"
                style={{
                  alignSelf: "flex-start",
                  backgroundColor: providerHomeActiveBookingNeedsAction(status)
                    ? colors.brandTint
                    : colors.surface2,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                }}
              >
                {t(statusKey)}
              </Text>
            ) : null}
            {nextStepKey ? (
              <Text size="sm" weight="bold" tone="brand">
                {t(nextStepKey)}
              </Text>
            ) : null}
          </View>
        ) : null}
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
