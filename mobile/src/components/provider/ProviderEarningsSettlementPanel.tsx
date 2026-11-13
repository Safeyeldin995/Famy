import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { money } from "@/lib/presentation";
import { moneyTextStyle } from "@/ui/Page";
import {
  settlementBalanceHeadline,
  useProviderSettlementBalance,
  useProviderSettlementPeriod,
  useProviderSettlements,
  useProviderWeekLedgerTotals,
} from "@/lib/provider/settlementQueries";

function formatSettlementWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  return d.toLocaleString(locale.startsWith("ar") ? "ar-EG" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Cairo",
  });
}

export function ProviderEarningsSettlementPanel({
  providerId,
}: {
  providerId: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const balance = useProviderSettlementBalance(providerId);
  const period = useProviderSettlementPeriod();
  const week = useProviderWeekLedgerTotals(providerId, period.data);
  const settlements = useProviderSettlements(providerId);
  const net = balance.data?.net ?? 0;
  const formatAmount = (n: number) => money(n, i18n.language);

  if (!providerId) return null;

  return (
    <View
      style={{
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        padding: space.md,
        gap: space.sm,
      }}
    >
      <Text weight="heavy">{t("pro.settlement.title")}</Text>
      <Text weight="bold">{settlementBalanceHeadline(net, t, formatAmount)}</Text>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1, borderRadius: radius.lg, backgroundColor: colors.surface2, padding: space.sm }}>
          <Text tone="muted" size="xs">
            {t("pro.settlement.cashWeek")}
          </Text>
          <Text weight="bold" style={moneyTextStyle(i18n.language)}>
            {money(week.data?.cash ?? 0, i18n.language)}
          </Text>
        </View>
        <View style={{ flex: 1, borderRadius: radius.lg, backgroundColor: colors.surface2, padding: space.sm }}>
          <Text tone="muted" size="xs">
            {t("pro.settlement.onlineWeek")}
          </Text>
          <Text weight="bold" style={moneyTextStyle(i18n.language)}>
            {money(week.data?.online ?? 0, i18n.language)}
          </Text>
        </View>
      </View>
      {period.data?.next_settlement_at ? (
        <Text tone="muted" size="xs">
          {t("pro.settlement.nextDate", {
            when: formatSettlementWhen(period.data.next_settlement_at, i18n.language),
          })}
        </Text>
      ) : null}
      <Text weight="bold" size="sm">
        {t("pro.settlement.history")}
      </Text>
      {(settlements.data ?? []).slice(0, 8).map((s) => (
        <View key={s.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text size="xs" tone="muted" style={{ flex: 1 }}>
            {new Date(s.period_start).toLocaleDateString()} · {s.status}
          </Text>
          <Text weight="bold" size="xs" style={moneyTextStyle(i18n.language)}>
            {money(s.amount, i18n.language)}
          </Text>
        </View>
      ))}
      {!settlements.data?.length ? (
        <Text tone="muted" size="xs">
          {t("pro.settlement.noHistory")}
        </Text>
      ) : null}
    </View>
  );
}
