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
import { providerSettlementDirectionLabel } from "@/lib/settlement/providerSettlementDirection";
import { useLang } from "@/components/famio/LanguageToggle";

export function ProviderEarningsSettlementPanel({ providerId }: { providerId: string | undefined }) {
  const { t } = useTranslation();
  const lang = useLang();
  const balance = useProviderSettlementBalance(providerId);
  const period = useProviderSettlementPeriod();
  const week = useProviderWeekLedgerTotals(providerId, period.data);
  const settlements = useProviderSettlements(providerId);
  const net = balance.data?.net ?? 0;

  if (!providerId) return null;

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-pro-14 font-extrabold">{t("pro.settlement.title")}</h2>
      <p className="text-base font-bold">
        {settlementBalanceHeadline(net, (k, o) => t(k, o), formatEGP)}
      </p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface-2 p-2">
          <p className="text-xs text-muted-foreground">{t("pro.settlement.cashWeek")}</p>
          <p className="font-bold tabular-nums">{formatEGP(week.data?.cash ?? 0)}</p>
        </div>
        <div className="rounded-xl bg-surface-2 p-2">
          <p className="text-xs text-muted-foreground">{t("pro.settlement.onlineWeek")}</p>
          <p className="font-bold tabular-nums">{formatEGP(week.data?.online ?? 0)}</p>
        </div>
      </div>
      {period.data?.next_settlement_at ? (
        <p className="text-pro-12 text-muted-foreground">
          {t("pro.settlement.nextDate", {
            when: formatSettlementWhen(period.data.next_settlement_at, lang),
          })}
        </p>
      ) : null}
      <div>
        <h3 className="text-pro-13 font-bold">{t("pro.settlement.history")}</h3>
        <ul className="mt-2 space-y-2">
          {(settlements.data ?? []).slice(0, 8).map((s) => (
            <li key={s.id} className="flex justify-between gap-2 text-pro-12">
              <span className="min-w-0">
                <span className="block">
                  {new Date(s.period_start).toLocaleDateString()} – {s.status}
                </span>
                <span className="text-pro-11 font-semibold text-muted-foreground">
                  {providerSettlementDirectionLabel(s.direction, t)}
                </span>
              </span>
              <span className="shrink-0 font-bold tabular-nums">{formatEGP(s.amount)}</span>
            </li>
          ))}
          {!settlements.data?.length ? (
            <li className="text-muted-foreground">{t("pro.settlement.noHistory")}</li>
          ) : null}
        </ul>
      </div>
    </Card>
  );
}
