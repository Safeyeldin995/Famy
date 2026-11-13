import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import {
  settlementBalanceHeadline,
  useProviderCashDebtBlocked,
  useProviderSettlementBalance,
  useProviderSettlementSettings,
} from "@/lib/provider/settlementQueries";
import { money } from "@/lib/presentation";
import { providerCashDebtNearLimit } from "@shared/settlement/settlementPresentation";

export function ProviderSettlementBanner({ providerId }: { providerId?: string }) {
  const { t, i18n } = useTranslation();
  const balance = useProviderSettlementBalance(providerId);
  const blocked = useProviderCashDebtBlocked(providerId);
  const settings = useProviderSettlementSettings();
  if (!providerId || balance.isLoading) return null;

  const net = balance.data?.net ?? 0;
  const debt = net < 0 ? Math.abs(net) : 0;
  const blockedActive = blocked.data === true;
  const limit = settings.data?.cash_debt_limit ?? 1000;
  const warnPercent = settings.data?.cash_debt_warn_percent ?? 80;
  const warnActive = !blockedActive && providerCashDebtNearLimit(net, limit, warnPercent);
  const formatAmount = (n: number) => money(n, i18n.language);

  return (
    <View
      style={{
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: blockedActive ? colors.destructive : warnActive ? colors.warning : colors.border,
        backgroundColor: blockedActive ? colors.brandTint : colors.surface,
        padding: space.md,
        gap: space.xs,
      }}
    >
      <Text weight="heavy">{t("pro.settlement.currentBalance")}</Text>
      <Text weight="heavy">
        {settlementBalanceHeadline(net, (k, o) => t(k, o as Record<string, string> | undefined), formatAmount)}
      </Text>
      {balance.data && balance.data.cash_held_for_platform > 0 ? (
        <Text size="xs" tone="muted">
          {t("pro.settlement.cashHeld", { amount: formatAmount(balance.data.cash_held_for_platform) })}
        </Text>
      ) : null}
      {warnActive ? (
        <Text size="sm" style={{ color: colors.warning }}>
          {t("pro.settlement.warnBody", { amount: formatAmount(debt) })}
        </Text>
      ) : null}
      {blockedActive ? (
        <Text size="sm" style={{ color: colors.destructive }}>
          {t("pro.settlement.blockedBody", { amount: formatAmount(debt) })}
        </Text>
      ) : null}
    </View>
  );
}
