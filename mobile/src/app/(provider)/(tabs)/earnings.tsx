import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { earningsHeadlineKind } from "@shared/earnings/aggregateProviderEarnings";
import { useMyProvider, useProviderBookings, useProviderEarnings } from "@/lib/provider/queries";
import { localized, money, dateTime } from "@/lib/presentation";
import { proCard } from "@/ui/provider/cards";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

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
    .filter((b) => b.status === "completed")
    .slice(0, 15);

  return (
    <Page tab title={t("pro.earnings.title")} queries={[p, e, bookingsQ]}>
      <View style={[proCard.card, { backgroundColor: colors.brand, gap: space.sm }]}>
        <Text weight="heavy" style={{ color: colors.brandForeground }}>
          {t("proRound2.paid")}
        </Text>
        <Text weight="heavy" style={{ color: colors.brandForeground, fontSize: 28 }}>
          {money(heroAmount, i18n.language)}
        </Text>
        <Text style={{ color: colors.brandForeground }}>
          {t("pro.earnings.fromCompleted", { count: e.data?.completedCount ?? 0 })}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={[proCard.card, { flex: 1 }]}>
          <Text weight="bold">{t("proWork.thisMonth")}</Text>
          <Text weight="heavy" tone="brand">
            {money(e.data?.mtd.net ?? 0, i18n.language)}
          </Text>
        </View>
        <View style={[proCard.card, { flex: 1 }]}>
          <Text weight="bold">{t("pro.earnings.upcomingPipeline")}</Text>
          <Text weight="heavy" tone="brand">
            {money(e.data?.upcoming.net ?? 0, i18n.language)}
          </Text>
        </View>
      </View>
      <Text weight="heavy">{t("pro.earnings.recentPayouts")}</Text>
      <QueryState query={bookingsQ} empty={!completed.length} emptyKey="pro.bookings.emptyHistory">
        {completed.map((b) => {
          const service = b.service as { name_ar?: string; name_en?: string } | undefined;
          return (
            <View key={String(b.id)} style={proCard.card}>
              <Text weight="bold">{localized(service, i18n.language)}</Text>
              <Text tone="muted" size="sm">
                {dateTime(String(b.start_at), i18n.language)}
              </Text>
              <Text weight="heavy" tone="brand">
                {money(Number(b.price_total ?? 0), i18n.language)}
              </Text>
            </View>
          );
        })}
      </QueryState>
    </Page>
  );
}
