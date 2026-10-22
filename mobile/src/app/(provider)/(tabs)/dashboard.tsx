import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Bell, Star } from "lucide-react-native";
import { BOOKING_ACTIVE_STATUSES } from "@/lib/provider/constants";
import { earningsHeadlineKind } from "@shared/earnings/aggregateProviderEarnings";
import {
  useMyProvider,
  useProUnreadNotificationCount,
  useProviderBookings,
  useProviderEarnings,
} from "@/lib/provider/queries";
import { localized, money, dateTime } from "@/lib/presentation";
import { BookingRequestActions } from "@/ui/provider/BookingRequestActions";
import { proCard } from "@/ui/provider/cards";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

export default function ProviderDashboard() {
  const { t, i18n } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const bookingsQ = useProviderBookings(provider?.id as string | undefined);
  const earningsQ = useProviderEarnings(provider?.id as string | undefined);
  const unreadQ = useProUnreadNotificationCount();
  const profile = provider?.profile as { full_name?: string; avatar_url?: string } | undefined;
  const firstName = (profile?.full_name || t("pro.common.customer")).trim().split(/\s+/)[0];
  const all = (bookingsQ.data ?? []) as Record<string, unknown>[];
  const pending = all.filter((b) => b.status === "pending");
  const today = new Date();
  const upcoming = all
    .filter(
      (b) =>
        BOOKING_ACTIVE_STATUSES.includes(b.status as (typeof BOOKING_ACTIVE_STATUSES)[number]) &&
        new Date(String(b.start_at)) >= new Date(today.toDateString()),
    )
    .sort((a, b) => +new Date(String(a.start_at)) - +new Date(String(b.start_at)));
  const next = upcoming[0];
  const mtdNet = earningsQ.data?.mtd.net ?? 0;
  const mtdBookingValue = earningsQ.data?.mtd.bookingValue ?? 0;
  const mtdKind = earningsHeadlineKind(mtdNet > 0, mtdBookingValue > 0);
  const ratings = provider?.ratings as
    { rating_avg?: number }[] | { rating_avg?: number } | undefined;
  const rating = (Array.isArray(ratings) ? ratings[0]?.rating_avg : ratings?.rating_avg) ?? null;

  return (
    <Page tab title={t("proWork.hello", { name: firstName })} queries={[p, bookingsQ, earningsQ]}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("notifs.title")}
          onPress={() => router.push("/pro-notifications")}
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Bell size={22} color={colors.brand} />
          {(unreadQ.data ?? 0) > 0 ? (
            <View
              style={{
                position: "absolute",
                top: 8,
                end: 8,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.brand,
              }}
            />
          ) : null}
        </Pressable>
      </View>
      <Text tone="muted">
        {next
          ? `${t("proWork.nextJob")}: ${dateTime(String(next.start_at), i18n.language)}`
          : t("proWork.noJobToday")}
      </Text>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            mtdKind === "bookingValue" ? t("proWork.monthValue") : t("proWork.monthNet")
          }
          onPress={() => router.push("/earnings")}
          style={[proCard.card, { flex: 1, backgroundColor: colors.brand }]}
        >
          <Text tone="brand" weight="bold" style={{ color: colors.brandForeground }}>
            {mtdKind === "bookingValue" ? t("proWork.monthValue") : t("proWork.monthNet")}
          </Text>
          <Text weight="heavy" style={{ color: colors.brandForeground, fontSize: 22 }}>
            {money(mtdKind === "bookingValue" ? mtdBookingValue : mtdNet, i18n.language)}
          </Text>
        </Pressable>
        <View style={[proCard.card, { flex: 1 }]}>
          <Text tone="muted" size="sm" weight="bold">
            {t("proWork.rating")}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Star size={16} color={colors.warning} fill={colors.warning} />
            <Text weight="heavy" size="lg" style={{ writingDirection: "ltr" }}>
              {rating ? Number(rating).toFixed(2) : "—"}
            </Text>
          </View>
        </View>
      </View>
      <Text weight="heavy" size="lg">
        {t("pro.dashboard.newRequests")}
      </Text>
      <QueryState query={bookingsQ} empty={!pending.length} emptyKey="pro.bookings.emptyRequests">
        {pending.map((b) => {
          const customer = b.customer as { full_name?: string } | undefined;
          const service = b.service as { name_ar?: string; name_en?: string } | undefined;
          return (
            <Pressable
              key={String(b.id)}
              accessibilityRole="button"
              accessibilityLabel={`${customer?.full_name || t("pro.common.customer")}, ${localized(service, i18n.language)}`}
              onPress={() =>
                router.push({ pathname: "/pro-booking/[id]", params: { id: String(b.id) } })
              }
              style={proCard.card}
            >
              <Text weight="heavy">{customer?.full_name || t("pro.common.customer")}</Text>
              <Text>{localized(service, i18n.language)}</Text>
              <Text tone="muted" size="sm">
                {dateTime(String(b.start_at), i18n.language)}
              </Text>
              <Text weight="heavy" tone="brand">
                {money(Number(b.price_total ?? 0), i18n.language)}
              </Text>
              <BookingRequestActions id={String(b.id)} />
            </Pressable>
          );
        })}
      </QueryState>
    </Page>
  );
}
