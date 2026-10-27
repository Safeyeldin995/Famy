import { View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  earningsHeadlineKind,
  isCommissionSnapshotted,
  providerBookingValue,
  type EarningsBucket,
} from "@shared/earnings/aggregateProviderEarnings";
import { useMyProvider, useProviderBookings, useProviderEarnings } from "@/lib/provider/queries";
import { localized, money } from "@/lib/presentation";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

function SplitAmounts({
  bucket,
  hasNet,
  hasBookingValue,
}: {
  bucket?: EarningsBucket;
  hasNet: boolean;
  hasBookingValue: boolean;
}) {
  const { t, i18n } = useTranslation();
  const kind = earningsHeadlineKind(hasNet, hasBookingValue);
  return (
    <View style={{ gap: 8 }}>
      {kind !== "bookingValue" ? (
        <View>
          <Text size="xs" tone="muted">
            {t("pro.earnings.yourNet")}
          </Text>
          <Text weight="heavy" size="lg" style={{ writingDirection: "ltr" }}>
            {money(bucket?.net ?? 0, i18n.language)}
          </Text>
        </View>
      ) : null}
      {kind === "bookingValue" || kind === "mixed" ? (
        <View>
          {kind === "mixed" ? (
            <Text size="xs" tone="muted">
              {t("proFinalPolish.beforeCommission")}
            </Text>
          ) : null}
          <Text weight="heavy" size="lg" style={{ writingDirection: "ltr" }}>
            {money(bucket?.bookingValue ?? 0, i18n.language)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function ProviderEarnings() {
  const { t, i18n } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as { id?: string } | null | undefined;
  const e = useProviderEarnings(provider?.id);
  const bookingsQ = useProviderBookings(provider?.id);
  const capturedKind = earningsHeadlineKind(
    e.data?.hasSnapshottedCaptured ?? false,
    e.data?.hasUnsnapshottedCaptured ?? false,
  );
  const heroAmount =
    capturedKind === "bookingValue"
      ? (e.data?.captured.bookingValue ?? 0)
      : (e.data?.captured.net ?? 0);
  const completed = ((bookingsQ.data ?? []) as Record<string, unknown>[])
    .filter((booking) => booking.status === "completed")
    .sort((a, b) => +new Date(String(b.start_at)) - +new Date(String(a.start_at)))
    .slice(0, 20);
  const hasUnrecordedCommission = !!(
    e.data?.hasUnsnapshottedCaptured ||
    e.data?.hasUnsnapshottedUpcoming ||
    completed.some((booking) => !isCommissionSnapshotted(booking))
  );
  const card = {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
  } as const;
  return (
    <Page
      tab
      title={t("pro.earnings.title")}
      queries={[p, e, bookingsQ]}
      contentStyle={{ gap: 12 }}
    >
      {hasUnrecordedCommission ? (
        <Text tone="muted" size="xs">
          {t("pro.earnings.bookingValue")}
        </Text>
      ) : null}
      <View
        style={{
          borderRadius: radius.xl,
          padding: 20,
          backgroundColor: colors.brand,
          gap: space.sm,
        }}
      >
        <Text weight="heavy" size="xl" style={{ color: colors.brandForeground }}>
          {t("proRound2.paid")}
        </Text>
        {capturedKind !== "bookingValue" ? (
          <Text weight="bold" style={{ color: colors.brandForeground }}>
            {t("pro.earnings.yourNet")}
          </Text>
        ) : null}
        <Text
          weight="heavy"
          size="hero"
          style={{ color: colors.brandForeground, writingDirection: "ltr" }}
        >
          {money(heroAmount, i18n.language)}
        </Text>
        {capturedKind === "mixed" ? (
          <Text size="sm" style={{ color: colors.brandForeground }}>
            {t("proFinalPolish.beforeCommission")}:{" "}
            {money(e.data?.captured.bookingValue ?? 0, i18n.language)}
          </Text>
        ) : null}
        <Text size="xs" style={{ color: colors.brandForeground }}>
          {t("pro.earnings.fromCompleted", { count: e.data?.completedCount ?? 0 })}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <View style={[card, { flex: 1 }]}>
          <Text weight="bold" size="sm">
            {t("proWork.thisMonth")}
          </Text>
          <SplitAmounts
            bucket={e.data?.mtd}
            hasNet={(e.data?.mtd.net ?? 0) > 0}
            hasBookingValue={(e.data?.mtd.bookingValue ?? 0) > 0}
          />
        </View>
        <View style={[card, { flex: 1 }]}>
          <Text weight="bold" size="sm">
            {t("proWork.last7")}
          </Text>
          <SplitAmounts
            bucket={e.data?.last7}
            hasNet={(e.data?.last7.net ?? 0) > 0}
            hasBookingValue={(e.data?.last7.bookingValue ?? 0) > 0}
          />
        </View>
      </View>
      <View style={card}>
        <Text weight="bold" size="sm">
          {t("proRound2.upcomingWork")}
        </Text>
        <SplitAmounts
          bucket={e.data?.upcoming}
          hasNet={e.data?.hasSnapshottedUpcoming ?? false}
          hasBookingValue={e.data?.hasUnsnapshottedUpcoming ?? false}
        />
        <Text tone="muted" size="xs">
          {t("proRound2.upcomingWorkCaption")}
        </Text>
      </View>
      {hasUnrecordedCommission ? (
        <Text tone="muted" size="xs">
          {t("proFinalPolish.summaryCommission")}
        </Text>
      ) : null}
      <Text weight="heavy">{t("pro.earnings.recentPayouts")}</Text>
      <QueryState query={bookingsQ} empty={!completed.length} emptyKey="pro.earnings.noPayoutsBody">
        {completed.map((booking) => {
          const customer = booking.customer as { full_name?: string } | undefined;
          const service = booking.service as { name_ar?: string; name_en?: string } | undefined;
          const snapshotted = isCommissionSnapshotted(booking);
          return (
            <View
              key={String(booking.id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                backgroundColor: colors.surface,
                borderRadius: radius.xl,
                padding: 12,
              }}
            >
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
                  {(customer?.full_name || t("pro.common.customer")).slice(0, 1)}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text weight="bold">{customer?.full_name || t("pro.common.customer")}</Text>
                <Text tone="muted" size="xs">
                  {localized(service, i18n.language)}
                </Text>
                {!snapshotted ? (
                  <Text tone="muted" size="xs">
                    {t("pro.earnings.commissionUnrecorded")}
                  </Text>
                ) : null}
              </View>
              <Text weight="heavy" style={{ writingDirection: "ltr" }}>
                {money(
                  snapshotted
                    ? Number(booking.price_provider_net ?? 0)
                    : providerBookingValue(booking),
                  i18n.language,
                )}
              </Text>
            </View>
          );
        })}
      </QueryState>
    </Page>
  );
}
