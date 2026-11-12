import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type ProviderBalance = {
  total_credits: number;
  total_debits: number;
  net: number;
  cash_held_for_platform: number;
};

export function useProviderSettlementBalance(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-settlement-balance", providerId],
    queryFn: async (): Promise<ProviderBalance> => {
      const { data, error } = await supabase.rpc("provider_balance", {
        p_provider_id: providerId!,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as ProviderBalance | undefined;
      return {
        total_credits: Number(row?.total_credits ?? 0),
        total_debits: Number(row?.total_debits ?? 0),
        net: Number(row?.net ?? 0),
        cash_held_for_platform: Number(row?.cash_held_for_platform ?? 0),
      };
    },
  });
}

export function useProviderCashDebtBlocked(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-cash-debt-blocked", providerId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("provider_cash_debt_blocked", {
        p_provider_id: providerId!,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });
}

export function settlementBalanceHeadline(
  net: number,
  t: (k: string, o?: object) => string,
  formatAmount: (n: number) => string,
) {
  if (net > 0) return t("pro.settlement.famyOwesYou", { amount: formatAmount(net) });
  if (net < 0) return t("pro.settlement.youOweFamy", { amount: formatAmount(Math.abs(net)) });
  return t("pro.settlement.balanced");
}
