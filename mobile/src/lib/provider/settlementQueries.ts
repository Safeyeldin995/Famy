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

export type ProviderSettlementRow = {
  id: string;
  period_start: string;
  amount: number;
  status: string;
};

export function useProviderSettlementPeriod() {
  return useQuery({
    queryKey: ["provider-settlement-closed-period"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("provider_settlement_closed_period");
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as {
        period_start: string;
        period_end: string;
        next_settlement_at: string;
      };
      return row;
    },
  });
}

export type WeekLedgerRange = { from: string; to: string };

/** Ledger activity for the in-progress week: from last close through now (capped at next settlement). */
export function currentWeekLedgerRange(
  period: { period_end: string; next_settlement_at: string },
  now: Date = new Date(),
): WeekLedgerRange {
  const from = period.period_end;
  const nextMs = new Date(period.next_settlement_at).getTime();
  const to = now.getTime() < nextMs ? now.toISOString() : period.next_settlement_at;
  return { from, to };
}

export function useProviderWeekLedgerTotals(
  providerId: string | undefined,
  range: WeekLedgerRange | undefined,
) {
  return useQuery({
    enabled: !!providerId && !!range?.from && !!range?.to,
    queryKey: ["provider-week-ledger", providerId, range?.from, range?.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_ledger_entries")
        .select("kind, amount")
        .eq("provider_id", providerId!)
        .gte("created_at", range!.from)
        .lte("created_at", range!.to);
      if (error) throw error;
      let cash = 0;
      let online = 0;
      for (const row of data ?? []) {
        const amount = Number(row.amount ?? 0);
        if (row.kind === "cash_collected_platform_share") cash += amount;
        if (row.kind === "online_provider_share") online += amount;
      }
      return { cash, online };
    },
  });
}

export function useProviderSettlements(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-settlements", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_settlements")
        .select("id, period_start, amount, status")
        .eq("provider_id", providerId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProviderSettlementRow[];
    },
  });
}

export function settlementBalanceHeadline(
  net: number,
  t: (key: string, opts?: Record<string, string>) => string,
  formatAmount: (n: number) => string,
) {
  if (net > 0) return t("pro.settlement.famyOwesYou", { amount: formatAmount(net) });
  if (net < 0) return t("pro.settlement.youOweFamy", { amount: formatAmount(Math.abs(net)) });
  return t("pro.settlement.balanced");
}
