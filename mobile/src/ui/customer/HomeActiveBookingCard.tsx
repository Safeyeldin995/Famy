import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { CalendarDays, Clock } from "lucide-react-native";
import {
  customerHomeActiveBookingCtaKey,
  customerHomeActiveBookingNeedsAction,
  customerHomeActiveBookings,
  homeActiveBookingStatusKey,
  pickSoonestCustomerHomeActiveBooking,
} from "@shared/home/activeHomeBookings";
import { customerBookingListWhen, localized } from "@/lib/presentation";
import { customerNumber } from "@/lib/customerFormat";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { colors, radius, space } from "@/ui/theme";
import { customerStyle } from "./Primitives";

type HomeBookingRow = {
  id: string;
  status: string;
  start_at: string;
  provider?: { profile: { full_name?: string | null } } | null;
  service?: { name_ar?: string | null; name_en?: string | null } | null;
};

export function HomeActiveBookingCard({
  bookings,
  parties,
}: {
  bookings: HomeBookingRow[];
  parties?: Map<string, { other_name?: string | null }>;
}) {
  const { t, i18n } = useTranslation();
  const focus = pickSoonestCustomerHomeActiveBooking(bookings);
  if (!focus) return null;
  const activeCount = customerHomeActiveBookings(bookings).length;
  const statusKey = homeActiveBookingStatusKey(focus.status);
  const needsAction = customerHomeActiveBookingNeedsAction(focus.status);
  const ctaKey = customerHomeActiveBookingCtaKey(focus.status);
  const name =
    parties?.get(focus.id)?.other_name ||
    focus.provider?.profile.full_name ||
    t("provider2.unnamed");
  const service = localized(focus.service, i18n.language);
  const when = customerBookingListWhen(focus.start_at, i18n.language);
  const testID = "home-active-booking";

  return (
    <View
      testID={testID}
      accessibilityRole="summary"
      style={[
        customerStyle.card,
        {
          marginHorizontal: space.xl,
          marginTop: space.lg,
          borderRadius: radius.xl,
          borderWidth: needsAction ? 2 : 1,
          borderColor: needsAction ? colors.brand : colors.border,
          backgroundColor: needsAction ? colors.brandTint : colors.surface,
        },
      ]}
    >
      <Text size="xs" weight="bold" tone="muted">
        {t("customerHome.activeBookingTitle")}
      </Text>
      <Text size="lg" weight="heavy">
        {statusKey ? t(statusKey) : t(`status.${focus.status}`)}
      </Text>
      <Text weight="bold">{name}</Text>
      <Text size="sm" tone="muted">
        {service}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <CalendarDays size={16} color={colors.muted} accessible={false} />
        <Clock size={16} color={colors.muted} accessible={false} />
        <Text size="sm" tone="muted" style={{ flex: 1 }}>
          {when}
        </Text>
      </View>
      <Button
        label={t(ctaKey)}
        onPress={() => router.push({ pathname: "/booking/[id]", params: { id: focus.id } })}
      />
      {activeCount > 1 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("customerHome.viewAllBookings")}
          onPress={() => router.push("/bookings")}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text size="sm" tone="brand" weight="bold">
            {t("customerHome.viewAllBookings")} ({customerNumber(activeCount, i18n.language)})
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
