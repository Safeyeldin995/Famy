import { Image, Pressable, View } from "react-native";
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
import { money } from "@/lib/presentation";
import { ProviderBookingCard, type ProviderCardBooking } from "@/ui/provider/ProviderBookingCard";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

export default function ProviderDashboard() {
  const { t, i18n } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const providerId = provider?.id as string | undefined;
  const bookingsQ = useProviderBookings(providerId);
  const earningsQ = useProviderEarnings(providerId);
  const unreadQ = useProUnreadNotificationCount();
  const profile = provider?.profile as { full_name?: string; avatar_url?: string } | undefined;
  const name = profile?.full_name || t("pro.common.customer");
  const firstName = name.trim().split(/\s+/)[0];
  const all = (bookingsQ.data ?? []) as ProviderCardBooking[];
  const pending = all.filter((booking) => booking.status === "pending");
  const upcoming = all
    .filter(
      (booking) =>
        BOOKING_ACTIVE_STATUSES.includes(booking.status as never) &&
        new Date(booking.start_at).getTime() >= new Date(new Date().toDateString()).getTime(),
    )
    .sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at))
    .slice(0, 3);
  const mtdNet = earningsQ.data?.mtd.net ?? 0;
  const mtdBookingValue = earningsQ.data?.mtd.bookingValue ?? 0;
  const mtdKind = earningsHeadlineKind(mtdNet > 0, mtdBookingValue > 0);
  const ratings = provider?.ratings as
    { rating_avg?: number }[] | { rating_avg?: number } | undefined;
  const rating = (Array.isArray(ratings) ? ratings[0]?.rating_avg : ratings?.rating_avg) ?? null;
  const header = (
    <View
      style={{
        minHeight: 72,
        paddingHorizontal: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: colors.surface,
      }}
    >
      <Text weight="heavy" size="title" style={{ flex: 1 }} numberOfLines={1}>
        {t("proWork.hello", { name: firstName })}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {profile?.avatar_url ? (
          <Image
            source={{ uri: profile.avatar_url }}
            style={{ width: 44, height: 44, borderRadius: 22 }}
          />
        ) : (
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.brandTint,
            }}
          >
            <Text weight="heavy" tone="brand">
              {firstName.slice(0, 1)}
            </Text>
          </View>
        )}
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
          <Bell size={20} color={colors.brand} />
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
    </View>
  );
  const sectionTitle = (title: string, onPress?: () => void) => (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <Text weight="heavy">{title}</Text>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("pro.common.seeAll")}
          onPress={onPress}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text tone="brand" weight="heavy" size="sm">
            {t("pro.common.seeAll")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
  return (
    <Page
      tab
      title={t("pro.nav.dashboard")}
      header={header}
      queries={[p, bookingsQ, earningsQ]}
      contentStyle={{ paddingTop: 8, gap: 16 }}
    >
      <Text tone="muted" size="sm">
        <Text weight="bold" size="sm">
          {t("proWork.today")}
        </Text>{" "}
        ·{" "}
        {upcoming[0]
          ? `${t("proWork.nextJob")}: ${new Intl.DateTimeFormat(i18n.language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB", { timeZone: "Africa/Cairo", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(upcoming[0].start_at))}`
          : t("proWork.noJobToday")}
      </Text>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            mtdKind === "bookingValue" ? "proWork.monthValue" : "proWork.monthNet",
          )}
          onPress={() => router.push("/earnings")}
          style={{
            flex: 1,
            minHeight: 90,
            borderRadius: radius.xl,
            padding: space.md,
            backgroundColor: colors.brand,
            justifyContent: "space-between",
          }}
        >
          <Text weight="bold" size="xs" style={{ color: colors.brandForeground }}>
            {t(mtdKind === "bookingValue" ? "proWork.monthValue" : "proWork.monthNet")}
          </Text>
          <Text
            weight="heavy"
            size="xxl"
            style={{ color: colors.brandForeground, writingDirection: "ltr" }}
          >
            {money(mtdKind === "bookingValue" ? mtdBookingValue : mtdNet, i18n.language)}
          </Text>
        </Pressable>
        <View
          style={{
            flex: 1,
            minHeight: 90,
            borderRadius: radius.xl,
            padding: space.md,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            justifyContent: "space-between",
          }}
        >
          <Text weight="bold" size="xs" tone="muted">
            {t("proWork.rating")}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Star size={16} color={colors.warning} fill={colors.warning} />
            <Text weight="heavy" size="xxl" style={{ writingDirection: "ltr" }}>
              {rating ? Number(rating).toFixed(2) : "—"}
            </Text>
          </View>
        </View>
      </View>
      {provider?.vacation_mode ? (
        <Text
          style={{ backgroundColor: colors.brandTint, borderRadius: radius.lg, padding: space.md }}
        >
          {t("pro.dashboard.vacationOn")} · {t("pro.dashboard.vacationOnBody")}
        </Text>
      ) : null}
      {sectionTitle(
        t("pro.dashboard.newRequests"),
        pending.length ? () => router.push("/jobs") : undefined,
      )}
      <QueryState query={bookingsQ} empty={!pending.length} emptyKey="pro.dashboard.noRequestsBody">
        {pending.slice(0, 3).map((booking) => (
          <ProviderBookingCard key={booking.id} booking={booking} request />
        ))}
      </QueryState>
      {sectionTitle(t("pro.dashboard.upcoming"), () => router.push("/jobs"))}
      {upcoming.length ? (
        upcoming.map((booking) => <ProviderBookingCard key={booking.id} booking={booking} />)
      ) : (
        <Text
          tone="muted"
          size="sm"
          style={{
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: colors.border,
            borderRadius: radius.xl,
            padding: 24,
            textAlign: "center",
          }}
        >
          {t("pro.dashboard.noUpcoming")}
        </Text>
      )}
    </Page>
  );
}
