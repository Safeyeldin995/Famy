import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { CalendarDays, Clock, MapPin } from "lucide-react-native";
import {
  providerHomeActiveBookingCtaKey,
  providerHomeActiveBookingNeedsAction,
  providerHomeActiveBookingNextStepKey,
  providerHomeActiveBookingStatusKey,
  providerHomeActiveBookingTargetStatus,
  providerHomeActiveBookings,
  pickSoonestProviderHomeActiveBooking,
} from "@shared/home/activeHomeBookings";
import {
  isBookingTooEarlyError,
  isProviderCompletionTooEarly,
  isProviderStepTooEarly,
  providerCompletionMinutesRemaining,
  providerStepOpensAt,
} from "@/lib/provider/timeWindow";
import { useProviderUpdateBookingStatus } from "@/lib/provider/queries";
import type { BookingParty } from "@/lib/provider/parties";
import { customerBookingListWhen, localized } from "@/lib/presentation";
import { customerNumber } from "@/lib/customerFormat";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { colors, radius, space } from "@/ui/theme";
import { customerStyle } from "@/ui/customer/Primitives";

type HomeBookingRow = {
  id: string;
  status?: string;
  start_at: string;
  end_at?: string;
  session_started_at?: string | null;
  arrival_confirmed_at?: string | null;
  customer?: { full_name?: string | null } | null;
  service?: { name_ar?: string | null; name_en?: string | null } | null;
  party?: BookingParty;
};

export function HomeProviderActiveBookingCard({
  bookings,
  pendingCount,
}: {
  bookings: HomeBookingRow[];
  pendingCount: number;
}) {
  const { t, i18n } = useTranslation();
  const mut = useProviderUpdateBookingStatus();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const normalized = bookings.map((b) => ({ ...b, status: String(b.status ?? "") }));
  const focus = pickSoonestProviderHomeActiveBooking<HomeBookingRow & { status: string }>(
    normalized,
  );
  const pendingChip =
    pendingCount > 0 ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("providerHome.pendingRequestsChip", { count: pendingCount })}
        onPress={() => router.push("/jobs")}
        style={{
          alignSelf: "flex-start",
          marginHorizontal: space.xl,
          marginTop: space.lg,
          minHeight: 36,
          paddingHorizontal: space.md,
          paddingVertical: space.xs,
          borderRadius: radius.pill,
          backgroundColor: colors.brandTint,
          borderWidth: 1,
          borderColor: colors.brand,
        }}
      >
        <Text size="sm" weight="bold" tone="brand">
          {t("providerHome.pendingRequestsChip", { count: pendingCount })}
        </Text>
      </Pressable>
    ) : null;

  if (!focus) return pendingChip;

  const activeCount = providerHomeActiveBookings(normalized).length;
  const status = String(focus.status ?? "");
  const statusKey = providerHomeActiveBookingStatusKey(status);
  const needsAction = providerHomeActiveBookingNeedsAction(status);
  const nextStepKey = providerHomeActiveBookingNextStepKey(status);
  const ctaKey = providerHomeActiveBookingCtaKey(status);
  const nextStatus = providerHomeActiveBookingTargetStatus(status);
  const fullName =
    focus.party?.other_name || focus.customer?.full_name || t("pro.common.customer");
  const firstName = fullName.trim().split(/\s+/)[0] || fullName;
  const service = localized(focus.service, i18n.language);
  const when = customerBookingListWhen(focus.start_at, i18n.language);
  const area =
    (i18n.language.startsWith("ar")
      ? focus.party?.zone_name_ar
      : focus.party?.zone_name_en) || focus.party?.area;
  const now = new Date(nowMs);
  const endAt = focus.end_at ?? focus.start_at;
  const stepTooEarly = isProviderStepTooEarly(status, focus.start_at, endAt, now);
  const stepOpensAt = providerStepOpensAt(status, focus.start_at, endAt);
  const completionTooEarly =
    status === "in_progress"
      ? isProviderCompletionTooEarly(
          {
            start_at: focus.start_at,
            end_at: endAt,
            session_started_at: focus.session_started_at ?? null,
            arrival_confirmed_at: focus.arrival_confirmed_at ?? null,
          },
          now,
        )
      : false;
  const completionMinutesLeft =
    completionTooEarly && status === "in_progress"
      ? providerCompletionMinutesRemaining(
          {
            start_at: focus.start_at,
            end_at: endAt,
            session_started_at: focus.session_started_at ?? null,
            arrival_confirmed_at: focus.arrival_confirmed_at ?? null,
          },
          now,
        )
      : 0;
  const ctaDisabled = stepTooEarly || completionTooEarly || mut.isPending;
  const testID = "provider-home-active-booking";

  const runStatus = () => {
    if (!nextStatus) return;
    mut.mutate(
      { id: focus.id, status: nextStatus },
      { onError: (e: Error) => isBookingTooEarlyError(e) && mut.reset() },
    );
  };

  return (
    <View style={{ gap: space.sm }}>
      {pendingChip}
      <View
        testID={testID}
        accessibilityRole="summary"
        style={[
          customerStyle.card,
          {
            marginHorizontal: space.xl,
            marginTop: pendingCount > 0 ? 0 : space.lg,
            borderRadius: radius.xl,
            borderWidth: needsAction ? 2 : 1,
            borderColor: needsAction ? colors.brand : colors.border,
            backgroundColor: needsAction ? colors.brandTint : colors.surface,
          },
        ]}
      >
        <Text size="xs" weight="bold" tone="muted">
          {t("providerHome.activeBookingTitle")}
        </Text>
        <Text size="lg" weight="heavy">
          {statusKey ? t(statusKey) : t(`status.${status}`)}
        </Text>
        {nextStepKey ? (
          <Text size="sm" tone="muted" weight="bold">
            {t(nextStepKey)}
          </Text>
        ) : null}
        <Text weight="bold">{firstName}</Text>
        <Text size="sm" tone="muted">
          {service}
        </Text>
        {area ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <MapPin size={16} color={colors.muted} accessible={false} />
            <Text size="sm" tone="muted" style={{ flex: 1 }}>
              {area}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <CalendarDays size={16} color={colors.muted} accessible={false} />
          <Clock size={16} color={colors.muted} accessible={false} />
          <Text size="sm" tone="muted" style={{ flex: 1 }}>
            {when}
          </Text>
        </View>
        {ctaKey ? (
          <View style={{ gap: space.xs }}>
            <Button
              label={t(ctaKey)}
              loading={mut.isPending}
              disabled={ctaDisabled}
              onPress={runStatus}
            />
            {stepTooEarly && stepOpensAt ? (
              <Text size="sm" tone="muted" style={{ textAlign: "center" }}>
                {t("pro.booking.tooEarly")}
              </Text>
            ) : null}
            {completionTooEarly ? (
              <Text size="sm" tone="muted" style={{ textAlign: "center" }}>
                {t("pro.booking.completionWaitMinutes", { count: completionMinutesLeft })}
              </Text>
            ) : null}
          </View>
        ) : (
          <Button
            label={t("providerHome.openBooking")}
            onPress={() =>
              router.push({ pathname: "/pro-booking/[id]", params: { id: focus.id } })
            }
          />
        )}
        {activeCount > 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("providerHome.viewAllBookings")}
            onPress={() => router.push("/jobs")}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text size="sm" tone="brand" weight="bold">
              {t("providerHome.viewAllBookings")} (
              {customerNumber(activeCount, i18n.language)})
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
