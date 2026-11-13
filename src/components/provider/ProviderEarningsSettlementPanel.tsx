import { useTranslation } from "react-i18next";
import { formatEGP } from "@/lib/utils";
import { Card } from "@/components/famio/ui";
import {
  settlementBalanceHeadline,
  useProviderSettlementBalance,
  useProviderSettlementPeriod,
  useProviderSettlements,
  useProviderWeekLedgerTotals,
} from "@/lib/db/provider-settlement-queries";
import { formatSettlementWhen } from "@/lib/settlement/cairoSettlementWeek";
import { settlementStateLabel } from "@/lib/settlement/moneyText";
import {
  settlementPeriodShort,
} from "@/lib/settlement/settlementPresentation";
import { useLang } from "@/components/famio/LanguageToggle";

export function ProviderEarningsSettlementPanel({ providerId }: { providerId: string | undefined }) {
  const { t } = useTranslation();
  const lang = useLang();
  const balance = useProviderSettlementBalance(providerId);
  const period = useProviderSettlementPeriod();
  const week = useProviderWeekLedgerTotals(providerId, period.data);
  const settlements = useProviderSettlements(providerId);
  const net = balance.data?.net ?? 0;
  const history = (settlements.data ?? []).filter((s) => Number(s.amount) > 0);

  if (!providerId) return null;

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-pro-14 font-extrabold">{t("pro.settlement.thisWeekTitle")}</h2>
        <p className="mt-1 text-base font-bold">
          {settlementBalanceHeadline(net, (k, o) => t(k, o), formatEGP)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-xs font-semibold text-muted-foreground">{t("pro.settlement.cashWeek")}</p>
          <p className="mt-1 font-extrabold tabular-nums">{formatEGP(week.data?.cash ?? 0)}</p>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-xs font-semibold text-muted-foreground">{t("pro.settlement.onlineWeek")}</p>
          <p className="mt-1 font-extrabold tabular-nums">{formatEGP(week.data?.online ?? 0)}</p>
        </div>
      </div>
      {period.data?.next_settlement_at ? (
        <p className="text-pro-12 font-semibold text-muted-foreground">
          {t("pro.settlement.nextDate", {
            when: formatSettlementWhen(period.data.next_settlement_at, lang),
          })}
        </p>
      ) : null}
      <div>
        <h3 className="text-pro-13 font-extrabold">{t("pro.settlement.history")}</h3>
        {history.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border/60 bg-surface-2/40 px-3 py-6 text-center text-pro-12 text-muted-foreground">
            {t("pro.settlement.noHistory")}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border/40 rounded-xl border border-border/50">
            {history.slice(0, 8).map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-3 text-pro-12">
                <div className="min-w-0 space-y-1">
                  <p className="font-bold tabular-nums">{formatEGP(s.amount)}</p>
                  <p className="text-pro-11 text-muted-foreground">
                    {settlementPeriodShort(s.period_start, s.period_end, lang)}
                  </p>
                  <p className="text-pro-11 font-semibold text-foreground">
                    {settlementStateLabel(s, "provider", t)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
