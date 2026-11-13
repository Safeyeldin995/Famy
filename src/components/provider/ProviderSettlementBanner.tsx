import { useTranslation } from "react-i18next";
import { formatEGP } from "@/lib/utils";
import {
  settlementBalanceHeadline,
  useProviderCashDebtBlocked,
  useProviderSettlementBalance,
  useProviderSettlementSettings,
} from "@/lib/db/provider-settlement-queries";
import { providerCashDebtNearLimit } from "@/lib/settlement/settlementPresentation";

export function ProviderSettlementBanner({ providerId }: { providerId: string | undefined }) {
  const { t } = useTranslation();
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

  return (
    <section
      className={`rounded-2xl border p-4 ${
        blockedActive
          ? "border-coral bg-coral/10"
          : warnActive
            ? "border-amber-500/40 bg-amber-500/10"
            : "border-border bg-surface"
      }`}
      data-testid="provider-settlement-banner"
    >
      <p className="text-sm font-extrabold">{t("pro.settlement.currentBalance")}</p>
      <p className="mt-1 text-base font-bold">
        {settlementBalanceHeadline(net, (k, o) => t(k, o), formatEGP)}
      </p>
      {balance.data && balance.data.cash_held_for_platform > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("pro.settlement.cashHeld", { amount: formatEGP(balance.data.cash_held_for_platform) })}
        </p>
      )}
      {warnActive ? (
        <p className="mt-2 text-sm font-semibold text-amber-800">
          {t("pro.settlement.warnBody", { amount: formatEGP(debt) })}
        </p>
      ) : null}
      {blockedActive && (
        <p className="mt-2 text-sm font-semibold text-coral">
          {t("pro.settlement.blockedBody", { amount: formatEGP(debt) })}
        </p>
      )}
    </section>
  );
}
