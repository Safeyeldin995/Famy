import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/ui/ProviderCard";
import { Bell, CalendarDays, CalendarRange, MessageCircle, Star } from "lucide-react-native";
import { unreadConversationCount, useConversations } from "@/lib/chatQueries";
import { dashboardUpcomingBookings } from "@shared/provider/providerWorkHelpers";
import { earningsHeadlineKind } from "@shared/earnings/aggregateProviderEarnings";
import {
  useMyProvider,
  useProUnreadNotificationCount,
  useProviderBookings,
  useProviderEarnings,
} from "@/lib/provider/queries";
import { money } from "@/lib/presentation";
import { joinUiParts, uiListSeparator } from "@shared/format/uiJoin";
import { ProviderBookingCard, type ProviderCardBooking } from "@/ui/provider/ProviderBookingCard";
import { HomeProviderActiveBookingCard } from "@/ui/provider/HomeProviderActiveBookingCard";
import { Page, QueryState, moneyTextStyle } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { ProviderEmptyState } from "@/ui/ProviderEmptyState";
import { colors, radius, space } from "@/ui/theme";

export default function ProviderDashboard() {
  const { t, i18n } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const providerId = provider?.id as string | undefined;
  const bookingsQ = useProviderBookings(providerId);
  const earningsQ = useProviderEarnings(providerId);
  const unreadQ = useProUnreadNotificationCount();
  const conversationsQ = useConversations();
  const messageUnread = unreadConversationCount(conversationsQ.data);
  const profile = provider?.profile as { full_name?: string; avatar_url?: string } | undefined;
  const firstName = (profile?.full_name?.trim().split(/\s+/)[0] || "").trim();
  const all = (bookingsQ.data ?? []) as ProviderCardBooking[];
  const pending = all.filter((booking) => booking.status === "pending");
  // Cairo calendar day (not the phone's), and jobs already under way always stay.
  const upcoming = dashboardUpcomingBookings(all);
  const mtdNet = earningsQ.data?.mtd.net ?? 0;
  const mtdBookingValue = earningsQ.data?.mtd.bookingValue ?? 0;
  const mtdKind = earningsHeadlineKind(mtdNet > 0, mtdBookingValue > 0);
  const ratings = provider?.ratings as
    { rating_avg?: number }[] | { rating_avg?: number } | undefined;
  const rating = (Array.isArray(ratings) ? ratings[0]?.rating_avg : ratings?.rating_avg) ?? null;
  const header = (
    <View
      style={{
        minHeight: 56,
        paddingHorizontal: space.xl,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: colors.surface,
      }}
    >
      <Text weight="heavy" size="title" style={{ flex: 1 }} numberOfLines={1}>
        {t("proWork.hello", {
          name: firstName || t("pro.common.greetingFallback"),
        })}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Avatar raw={profile?.avatar_url} size={44} round name={firstName || t("pro.common.greetingFallback")} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("nav.messages")}
          onPress={() => router.push("/pro-messages")}
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MessageCircle size={20} color={colors.brand} />
          {messageUnread > 0 ? (
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("notifs.title")}
          onPress={() => router.push("/pro-notifications")}
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.sm,
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
      contentStyle={{ paddingTop: space.sm, gap: space.lg }}
    >
      {!bookingsQ.isError && bookingsQ.data ? (
        <HomeProviderActiveBookingCard bookings={all} pendingCount={pending.length} />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("pro.dashboard.scheduleCard", {
          status: t(
            provider?.vacation_mode
              ? "pro.dashboard.scheduleStatusVacation"
              : "pro.dashboard.scheduleStatusAvailable",
          ),
        })}
        onPress={() => router.push("/schedule")}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          minHeight: 56,
          borderRadius: radius.xl,
          padding: space.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.sm,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.brandTint,
          }}
        >
          <CalendarRange size={22} color={colors.brand} />
        </View>
        <Text weight="heavy" style={{ flex: 1 }}>
          {t("pro.dashboard.scheduleCard", {
            status: t(
              provider?.vacation_mode
                ? "pro.dashboard.scheduleStatusVacation"
                : "pro.dashboard.scheduleStatusAvailable",
            ),
          })}
        </Text>
      </Pressable>
      <Text tone="muted" size="sm">
        <Text weight="bold" size="sm">
          {t("proWork.today")}
        </Text>
        {uiListSeparator(i18n.language)}
        {upcoming[0]
          ? (() => {
              const when = new Intl.DateTimeFormat(
                i18n.language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB",
                {
                  timeZone: "Africa/Cairo",
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                },
              ).format(new Date(upcoming[0].start_at));
              const sameDay =
                new Date(upcoming[0].start_at).toDateString() === new Date().toDateString();
              return sameDay
                ? `${t("proWork.nextJob")}: ${when}`
                : t("proWork.nextJobDate", { when });
            })()
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
            style={{ color: colors.brandForeground, ...moneyTextStyle(i18n.language) }}
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
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
          {joinUiParts([t("pro.dashboard.vacationOn"), t("pro.dashboard.vacationOnBody")], i18n.language)}
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
        <ProviderEmptyState
          icon={CalendarDays}
          title={t("pro.dashboard.noUpcoming")}
          body={t("pro.bookings.emptyUpcoming")}
        >
          <Button label={t("pro.common.seeAll")} variant="secondary" onPress={() => router.push("/schedule")} />
        </ProviderEmptyState>
      )}
    </Page>
  );
}
