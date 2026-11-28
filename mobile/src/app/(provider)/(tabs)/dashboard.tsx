import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/ui/ProviderCard";
import { Bell, CalendarDays, CalendarRange, MessageCircle, Star } from "lucide-react-native";
import { unreadConversationCount, useConversations } from "@/lib/chatQueries";
import { dashboardUpcomingBookings } from "@shared/provider/providerWorkHelpers";
import { earningsHeadlineKind } from "@shared/earnings/aggregateProviderEarnings";
import { pickProviderNextAction } from "@shared/provider/providerNextAction";
import {
  useMyProvider,
  useMyProviderServices,
  useProUnreadNotificationCount,
  useProviderBookings,
  useProviderEarnings,
} from "@/lib/provider/queries";
import { useProviderDocuments } from "@/lib/provider/profileQueries";
import { useProviderPerformanceStats } from "@/lib/provider/journeyQueries";
import { money } from "@/lib/presentation";
import { joinUiParts } from "@shared/format/uiJoin";
import { ProviderBookingCard, type ProviderCardBooking } from "@/ui/provider/ProviderBookingCard";
import { HomeProviderActiveBookingCard } from "@/ui/provider/HomeProviderActiveBookingCard";
import { TutorTeachingDataBanner } from "@/ui/provider/TutorTeachingDataBanner";
import { TutorDemandCard } from "@/ui/provider/TutorDemandCard";
import { Page, QueryState, moneyTextStyle } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { ProviderEmptyState } from "@/ui/ProviderEmptyState";
import { ProviderPerformanceCard } from "@/ui/provider/ProviderPerformanceCard";
import { ProviderNextActionStrip } from "@/ui/provider/ProviderNextActionStrip";
import { colors, radius, space } from "@/ui/theme";

export default function ProviderDashboard() {
  const { t, i18n } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const providerId = provider?.id as string | undefined;
  const bookingsQ = useProviderBookings(providerId);
  const earningsQ = useProviderEarnings(providerId);
  const statsQ = useProviderPerformanceStats();
  const servicesQ = useMyProviderServices(providerId);
  const docsQ = useProviderDocuments(providerId);
  const unreadQ = useProUnreadNotificationCount();
  const conversationsQ = useConversations();
  const messageUnread = unreadConversationCount(conversationsQ.data);
  const profile = provider?.profile as { full_name?: string; avatar_url?: string } | undefined;
  const firstName = (profile?.full_name?.trim().split(/\s+/)[0] || "").trim();
  const all = (bookingsQ.data ?? []) as ProviderCardBooking[];
  const pending = all.filter((booking) => booking.status === "pending");
  // Cairo calendar day (not the phone's), and jobs already under way always stay.
  const upcoming = dashboardUpcomingBookings(all);
  const nextAction = useMemo(() => {
    if (!bookingsQ.data) return null;
    const services = (servicesQ.data ?? []) as { status?: string }[];
    const docs = (docsQ.data ?? []) as { status?: string; type?: string }[];
    const requiredTypes = new Set(["id_card_front", "id_card_back"]);
    const missingDocument =
      docs.some((d) => d.status === "rejected") ||
      [...requiredTypes].some(
        (type) => !docs.some((d) => d.type === type && d.status === "approved"),
      );
    const rejectedService = services.some((s) => s.status === "rejected");
    return pickProviderNextAction({
      pending,
      upcoming,
      missingDocument,
      rejectedService,
    });
  }, [bookingsQ.data, docsQ.data, pending, servicesQ.data, upcoming]);
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
        <Avatar
          raw={profile?.avatar_url}
          size={44}
          round
          name={firstName || t("pro.common.greetingFallback")}
        />
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
      queries={[p, bookingsQ, earningsQ, statsQ]}
      contentStyle={{ paddingTop: space.sm, gap: space.lg }}
    >
      <TutorTeachingDataBanner />
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
      {nextAction ? <ProviderNextActionStrip action={nextAction} /> : null}
      {statsQ.data && provider?.is_verified ? (
        <ProviderPerformanceCard stats={statsQ.data} />
      ) : null}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("proReviews.title")}
          onPress={() => router.push("/pro-my-reviews")}
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
        </Pressable>
      </View>
      {provider?.vacation_mode ? (
        <Text
          style={{ backgroundColor: colors.brandTint, borderRadius: radius.lg, padding: space.md }}
        >
          {joinUiParts(
            [t("pro.dashboard.vacationOn"), t("pro.dashboard.vacationOnBody")],
            i18n.language,
          )}
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
          <Button
            label={t("pro.common.seeAll")}
            variant="secondary"
            onPress={() => router.push("/schedule")}
          />
        </ProviderEmptyState>
      )}
      <TutorDemandCard limit={3} />
    </Page>
  );
}
